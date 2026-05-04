// Package dispatch 负责把已入库的 Event 丢进后台 Agent Loop。
//
// 独立成包是为了避免 core → llm/tools 的循环依赖：
//
//	api → dispatch → { core, llm, tools }
//	         ↑
//	       plugin handlers 只拿到 *EventRouter
package dispatch

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/cloudwego/eino/schema"
	"gorm.io/gorm"

	"github.com/lulaide/orca/internal/core"
	"github.com/lulaide/orca/internal/knowledge"
	"github.com/lulaide/orca/internal/llm"
	"github.com/lulaide/orca/internal/tools"
)

// EventRouter 把一个已写入 events 表的 Event 扔进后台 Agent Loop。
// Webhook handler 只需 Dispatch 一下就可以立刻返 202；后续的 LLM 推理、
// 工具调用、Investigation 创建都在 goroutine 里完成。
type EventRouter struct {
	db     *gorm.DB
	engine *llm.Engine
	// agentTimeout 是单次 Agent Loop 的总超时（防止 LLM 卡住占内存）。
	agentTimeout time.Duration
}

// NewEventRouter 建一个 Router。agentTimeout=0 时用默认值 5 分钟。
func NewEventRouter(db *gorm.DB, engine *llm.Engine, agentTimeout time.Duration) *EventRouter {
	if agentTimeout <= 0 {
		agentTimeout = 5 * time.Minute
	}
	return &EventRouter{db: db, engine: engine, agentTimeout: agentTimeout}
}

// Dispatch 启动后台 goroutine 跑 Agent Loop，立即返回。
// 调用方应该已经 CreateEvent 成功（ev.ID 非空）。
func (r *EventRouter) Dispatch(ev *core.Event) {
	if r == nil || ev == nil {
		return
	}
	go r.runAgent(ev)
}

// runAgent 跑 Agent Loop 并写回 processed_at / agent_summary。
// 自动模式下同样创建一条 Conversation 并把 Agent 的每条消息（user / assistant /
// tool）写入 messages 表，这样前端 EventDetail 可以复用 /api/conversations/:id/messages
// + MessageBubble 把整个工具调用链完整展示出来。
func (r *EventRouter) runAgent(ev *core.Event) {
	ctx, cancel := context.WithTimeout(context.Background(), r.agentTimeout)
	defer cancel()
	// 注入 event_id，供 create_investigation 工具自动回链
	ctx = context.WithValue(ctx, tools.EventIDKey, ev.ID)

	log.Printf("EventRouter: agent dispatched for event %s (source=%s severity=%s)",
		ev.ID, ev.Source, ev.Severity)

	// 先创建一个 Conversation 容器并绑到 Event 上。失败不致命——继续跑，只是前端看不到消息流。
	var convID string
	if conv, err := core.CreateConversation(r.db, "事件："+ev.Title, "event", ""); err != nil {
		log.Printf("EventRouter: create conversation failed: %v", err)
	} else {
		convID = conv.ID
		if err := core.SetEventConversation(r.db, ev.ID, convID); err != nil {
			log.Printf("EventRouter: link event->conversation failed: %v", err)
		}
	}

	systemPrompt := buildAutoModeSystemPrompt(ev) + knowledge.BuildServiceContext(r.db)
	initialUserMsg := buildInitialUserMessage(ev)

	// 把初始 user 消息写入会话，让前端能看见"触发 Agent 的那段输入"。
	if convID != "" {
		if _, err := core.SaveEinoMessage(r.db, convID, schema.UserMessage(initialUserMsg)); err != nil {
			log.Printf("EventRouter: save initial user message failed: %v", err)
		}
	}

	input := llm.RunInput{
		SystemPrompt: systemPrompt,
		UserMessage:  initialUserMsg,
	}
	if convID != "" {
		input.OnMessage = func(m *schema.Message) {
			if m == nil {
				return
			}
			if _, err := core.SaveEinoMessage(r.db, convID, m); err != nil {
				log.Printf("EventRouter: save message failed: %v", err)
			}
		}
	}

	result, err := r.engine.Run(ctx, input)
	if err != nil {
		log.Printf("EventRouter: agent loop failed for event %s: %v", ev.ID, err)
		if err := core.MarkEventProcessed(r.db, ev.ID, "Agent loop failed: "+err.Error()); err != nil {
			log.Printf("EventRouter: mark processed failed: %v", err)
		}
		return
	}

	summary := ""
	if result != nil && result.Final != nil {
		summary = result.Final.Content
	}
	if err := core.MarkEventProcessed(r.db, ev.ID, summary); err != nil {
		log.Printf("EventRouter: mark processed failed: %v", err)
	}
	log.Printf("EventRouter: event %s processed in %d iterations (tokens: %d prompt + %d completion = %d total)",
		ev.ID, result.Iterations, result.PromptTokens, result.CompletionTokens, result.TotalTokens)
}

// buildInitialUserMessage 生成 Agent Loop 的首条 user 消息。
// 这条消息也会被存进 messages 表——前端用它作为事件详情的"起始输入"展示。
// 和 system prompt 不重复：system prompt 偏职责定义，这里就是简短的事件事实陈述。
func buildInitialUserMessage(ev *core.Event) string {
	var b strings.Builder
	b.WriteString("收到新的事件，请按系统提示开始处理。\n\n")
	fmt.Fprintf(&b, "- event_id: %s\n", ev.ID)
	fmt.Fprintf(&b, "- source: %s\n", ev.Source)
	fmt.Fprintf(&b, "- severity: %s\n", ev.Severity)
	fmt.Fprintf(&b, "- title: %s\n", ev.Title)
	if len(ev.Payload) > 0 {
		b.WriteString("- payload 见 system prompt 中附带的 JSON。\n")
	}
	return b.String()
}

// buildAutoModeSystemPrompt 为自动值守模式构造 Explorer 系统提示词。
// Explorer 只做诊断，不提方案。创建 Investigation 后进入流水线（Explorer → Generator → Evaluator）。
func buildAutoModeSystemPrompt(ev *core.Event) string {
	payloadJSON := "{}"
	if len(ev.Payload) > 0 {
		var pretty any
		if json.Unmarshal(ev.Payload, &pretty) == nil {
			if b, err := json.MarshalIndent(pretty, "", "  "); err == nil {
				payloadJSON = string(b)
			} else {
				payloadJSON = string(ev.Payload)
			}
		} else {
			payloadJSON = string(ev.Payload)
		}
	}

	return fmt.Sprintf(`你是 Orca Explorer Agent — 专职诊断员。当前是**无人值守**模式——没有用户可以提问。

你的**唯一职责**是排查问题根因。诊断完成后，后续会有 Generator Agent 生成方案、Evaluator Agent 评审方案。

Event id: %s
Event source: %s
Event severity: %s
Event title: %s
Event payload:
`+"```"+`json
%s
`+"```"+`

## 你的任务

1. **只读探索**：用 get_pods / describe_resource / get_pod_logs / get_events / get_node_status 等只读工具搞清楚集群里到底发生了什么，不要凭空编造发现。

2. **创建 Investigation 前先检查是否已有相关调查**：
   - 调用 list_investigations(view="active") 查看当前进行中的调查
   - 如果已有标题或描述相似的调查（同一个服务、同一类问题），**不要重复创建**，而是用 add_investigation_entry 追加发现到已有调查
   - 只有确认是全新的、没有被跟踪的问题时才 create_investigation

3. **自主决定本次事件要开几个 Investigation**：
   - **0 个** — 症状已自愈、瞬时抖动、或已有调查在跟踪
   - **1 个** — 只有一个明确的新问题
   - **N 个** — 发现多个彼此独立的新问题

4. **深入诊断**：用 add_investigation_entry(type="discovery") 把每个关键发现记录到时间线。每条简洁、事实性。

5. **提交排查报告**：诊断完成后，用 add_investigation_entry(type="report") 提交排查报告。
   报告必须包含：**根因判断** + **支撑证据** + **影响范围**

6. **推进流水线**：提交报告后，调用 update_investigation_status 将每个 Investigation 状态设为 "explored"。
   这会自动触发 Generator Agent 生成修复方案。

## 你绝对不能做的

- ❌ 不要提出修复方案（那是 Generator 的工作）
- ❌ 不要执行写操作（restart/scale/delete 等）
- ❌ 不要调用 resolve_investigation（那是验证通过后才做的）
- ❌ 不要调用 run_command（bash 命令需要审批，无人值守模式下会卡死）
- ❌ 不要调用 submit_solution（那是 Generator 的工作）

## 语言要求（重要）

**所有由你写入数据库的内容必须使用中文**，包括：
- Investigation 的 title / description
- investigation_entries 的 content
- 本次事件的最终 summary

工具调用参数里的 JSON key、identifier（如 namespace / pod 名）保留原样；仅自然语言字段用中文。

## Skill 技能系统

下方注入了"已知服务技能"列表。排查时先看有没有相关 skill：
- 有 → 调 read_skill(name) 加载排障手册，按手册排查
- 没有 → 正常排查

## 输出约定

你最后那段纯文本回复会作为 Event 的处理摘要入库。保持简短（1–3 句话）：说明你的结论 + 开了几个 Investigation。`,
		ev.ID, ev.Source, ev.Severity, ev.Title, payloadJSON)
}
