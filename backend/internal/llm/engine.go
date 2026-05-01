package llm

import (
	"context"
	"fmt"
	"log"

	"github.com/cloudwego/eino/schema"

	"github.com/lulaide/orca/internal/tools"
)

// Engine 是 Orca 的 Agentic Loop 执行器。
// 它串起 LLM Manager(当前活动的 ChatModel)和 Tool Registry(当前可用的工具),
// 实现多轮 Function Calling 的自动驾驶流程。
type Engine struct {
	manager  *Manager
	registry *tools.Registry
}

// NewEngine 创建引擎。
func NewEngine(mgr *Manager, reg *tools.Registry) *Engine {
	return &Engine{manager: mgr, registry: reg}
}

// RunInput 是一次推理的输入。
type RunInput struct {
	SystemPrompt string
	UserMessage  string
	// History 可选的已有对话历史(不含当前这次 UserMessage)。
	// 用户追问时传入,让 LLM 看到完整上下文。
	History []*schema.Message
	// OnMessage 每产生一条新消息时同步回调(assistant 决策 / tool 结果 / 最终文本)。
	// 用于 SSE 推流场景。调用方应该快速返回,避免阻塞 Agentic Loop。
	// nil 时不触发。
	OnMessage func(*schema.Message)
}

// RunResult 是一次推理的输出。
type RunResult struct {
	// Final 是最终的 assistant 消息(含文本结论)。
	Final *schema.Message
	// Messages 是本轮追加的所有消息(assistant tool_calls + tool results + final)。
	Messages []*schema.Message
	// Iterations 实际使用的迭代轮数。
	Iterations int
	// Token 用量统计（所有迭代累加）。
	PromptTokens     int
	CompletionTokens int
	TotalTokens      int
}

// Run 执行一次完整的 Agentic Loop。
//
// 流程:
//  1. 从 Manager 取当前 ChatModel,绑定 Registry 里所有工具
//  2. 组装 messages: [system, ...history, user]
//  3. for 循环:
//     a. 调 model.Generate
//     b. 如果返回了 tool_calls → 执行每个工具,追加结果,继续循环
//     c. 如果返回了纯文本 → 作为 Final 返回
//  4. 到达 max_iterations 还没有 Final → 返回错误
func (e *Engine) Run(ctx context.Context, in RunInput) (*RunResult, error) {
	baseModel := e.manager.ChatModel()
	if baseModel == nil {
		return nil, ErrNotConfigured
	}

	// 绑定当前注册表里的所有工具。
	// WithTools 返回新实例,不影响 Manager 里的共享 baseModel。
	cm := baseModel
	infos := e.registry.ToolInfos()
	if len(infos) > 0 {
		withTools, err := baseModel.WithTools(infos)
		if err != nil {
			return nil, fmt.Errorf("bind tools: %w", err)
		}
		cm = withTools
	}

	// 组装初始 messages。
	messages := make([]*schema.Message, 0, 2+len(in.History))
	if in.SystemPrompt != "" {
		messages = append(messages, schema.SystemMessage(in.SystemPrompt))
	}
	messages = append(messages, in.History...)
	if in.UserMessage != "" {
		messages = append(messages, schema.UserMessage(in.UserMessage))
	}

	// 本轮追加的消息(返回给调用方用于追加到 History)。
	added := make([]*schema.Message, 0, 4)
	var promptTokens, completionTokens int

	maxIter := e.manager.MaxIterations()
	for i := 0; i < maxIter; i++ {
		resp, err := cm.Generate(ctx, messages)
		if err != nil {
			return nil, fmt.Errorf("llm generate (iteration %d): %w", i+1, err)
		}

		// 累加 token 用量
		if resp.ResponseMeta != nil && resp.ResponseMeta.Usage != nil {
			promptTokens += resp.ResponseMeta.Usage.PromptTokens
			completionTokens += resp.ResponseMeta.Usage.CompletionTokens
		}

		// 情况 1: 纯文本回复 → 完成。
		if len(resp.ToolCalls) == 0 {
			added = append(added, resp)
			if in.OnMessage != nil {
				in.OnMessage(resp)
			}
			return &RunResult{
				Final:            resp,
				Messages:         added,
				Iterations:       i + 1,
				PromptTokens:     promptTokens,
				CompletionTokens: completionTokens,
				TotalTokens:      promptTokens + completionTokens,
			}, nil
		}

		// 情况 2: LLM 请求调用工具。
		log.Printf("Agentic Loop (iter %d): %d tool call(s) requested", i+1, len(resp.ToolCalls))
		messages = append(messages, resp)
		added = append(added, resp)
		if in.OnMessage != nil {
			in.OnMessage(resp)
		}

		for _, call := range resp.ToolCalls {
			toolName := call.Function.Name
			toolArgs := call.Function.Arguments
			log.Printf("  → %s(%s)", toolName, toolArgs)

			result, err := e.registry.Execute(ctx, toolName, toolArgs)
			if err != nil {
				// 不中断循环——把错误作为 tool result 回传给 LLM,让它自己决定下一步。
				result = fmt.Sprintf("ERROR: %s", err.Error())
				log.Printf("    ! %s", result)
			}

			// 手动构造 tool 消息,带上 ToolName 方便前端审计展示
			// (schema.ToolMessage helper 只填 Content + ToolCallID,不填 ToolName)。
			toolMsg := &schema.Message{
				Role:       schema.Tool,
				Content:    result,
				ToolCallID: call.ID,
				ToolName:   toolName,
			}
			messages = append(messages, toolMsg)
			added = append(added, toolMsg)
			if in.OnMessage != nil {
				in.OnMessage(toolMsg)
			}
		}
	}

	return nil, fmt.Errorf("agentic loop: max iterations (%d) reached without final answer", maxIter)
}
