package agents

import (
	"context"
	"fmt"
	"log"
	"time"

	"github.com/cloudwego/eino/schema"
	"gorm.io/gorm"

	"github.com/lulaide/orca/internal/core"
	"github.com/lulaide/orca/internal/llm"
	"github.com/lulaide/orca/internal/tools"
)

// RunEvaluator 启动 Evaluator Agent。
// 根据 Investigation 当前状态自动切换模式：
//   - evaluating → 评审 Generator 的修复方案
//   - verifying  → 验证修复是否生效
//
// 共享同一个 Agent，保留完整评审上下文，验证失败时能给出更好的改进建议。
func RunEvaluator(db *gorm.DB, engine *llm.Engine, inv *core.Investigation) {
	mode := "review"
	if inv.Status == core.StatusVerifying {
		mode = "verify"
	}
	log.Printf("Agents/Evaluator[%s]: starting for investigation %s (%s)", mode, inv.ID, inv.Title)

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()

	var convID string
	if conv, err := core.CreateConversation(db, "Evaluator: "+inv.Title, "agent", ""); err != nil {
		log.Printf("Agents/Evaluator: create conversation failed: %v", err)
	} else {
		convID = conv.ID
	}
	ctx = context.WithValue(ctx, tools.ConversationIDKey, convID)

	agentContext := buildAgentContext(db, inv)
	systemPrompt := buildEvaluatorPrompt(inv, mode) + agentContext + buildSkillContext(db)

	var userMessage string
	if mode == "verify" {
		userMessage = fmt.Sprintf("修复操作已执行，请验证调查 %s 的问题是否已解决。", inv.ID)
	} else {
		userMessage = fmt.Sprintf("请评审调查 %s 的修复方案。", inv.ID)
	}

	if convID != "" {
		core.SaveEinoMessage(db, convID, schema.UserMessage(userMessage))
	}

	result, err := engine.Run(ctx, llm.RunInput{
		SystemPrompt: systemPrompt,
		UserMessage:  userMessage,
		OnMessage: func(m *schema.Message) {
			if m == nil || convID == "" {
				return
			}
			core.SaveEinoMessage(db, convID, m)
		},
	})

	if err != nil {
		log.Printf("Agents/Evaluator[%s]: failed for investigation %s: %v", mode, inv.ID, err)
		core.CreateEntry(db, inv.ID, "note", "Evaluator Agent 执行失败: "+err.Error(), "ai")
		return
	}

	log.Printf("Agents/Evaluator[%s]: completed for investigation %s (%d iterations, %d tokens)",
		mode, inv.ID, result.Iterations, result.TotalTokens)
}

func buildEvaluatorPrompt(inv *core.Investigation, mode string) string {
	header := fmt.Sprintf(`你是 Orca Evaluator Agent — 负责方案评审和修复验证。

## 当前调查
- Investigation ID: %s
- 标题: %s
- 严重度: %s
`, inv.ID, inv.Title, inv.Severity)

	if mode == "verify" {
		return header + `
## 当前模式：验证修复

修复操作已经执行完毕。下方时间线中有"执行结果"记录了每个操作的输出。
你需要**验证问题是否真正解决**。

## 你必须做的

1. 使用 K8s 只读工具检查当前集群状态：
   - get_pods — 确认 Pod 状态是否恢复正常
   - describe_resource — 查看资源详情
   - get_pod_logs — 确认日志中没有异常
   - get_events — 查看是否有新的异常事件
2. 对比修复前的问题（见排查报告），判断问题是否已解决
3. 将验证结果记录到时间线：add_investigation_entry(type="verification")
4. 做出决定：
   - **已解决** → 调用 resolve_investigation 结案（填写 root_cause 和 solution）
   - **未解决** → 在 verification 中说明还存在什么问题，并给出改进方向（你之前评审过方案，结合那次的上下文提出更好的建议），然后调用 update_investigation_status 设为 "generating"

## verification entry 格式

### 验证结果：通过/未通过

**集群状态检查：** （当前 Pod/Service 状态）
**问题是否解决：** ✅/❌
**改进建议：** （如果未通过，结合之前的方案评审给出具体建议）

## 你绝对不能做的

- ❌ 不要执行写操作
- ❌ 不要调用 run_command

## 语言要求

所有输出使用中文。`
	}

	return header + `
## 当前模式：评审方案

下方注入了 Explorer 的排查报告和 Generator 提出的修复方案。

## 评估标准

1. 根因判断是否有**证据支撑**？（排查报告中是否有对应的日志/事件/指标）
2. 方案是否**直接解决根因**？（而不是治标不治本）
3. 有没有**风险或副作用**？（影响范围、服务中断时间等）
4. 有没有**更简单的方案**？
5. 工具调用参数是否**正确**？

## 你必须做的

1. 仔细阅读排查报告和修复方案
2. 按上述 5 个标准逐一评估
3. 将评审结果记录到时间线：add_investigation_entry(type="review")
4. 做出决定：
   - **通过** → 调用 update_investigation_status 设为 "awaiting_approval"
   - **不通过** → 在 review 中说明拒绝原因和改进方向，调用 update_investigation_status 设为 "generating"

## review entry 格式

### 评审结果：通过/不通过

**证据支撑：** ✅/❌ （说明）
**根因匹配：** ✅/❌ （说明）
**风险评估：** ✅/❌ （说明）
**方案合理性：** ✅/❌ （说明）
**参数正确性：** ✅/❌ （说明）

**总体评价：** （一句话总结）
**改进建议：** （如果不通过，具体说明需要修改什么）

## 你绝对不能做的

- ❌ 不要自己排查集群（只读工具可用于验证模式，评审模式下不需要）
- ❌ 不要自己提出新方案（只评估现有方案）
- ❌ 不要直接执行任何操作
- ❌ 不要调用 resolve_investigation（评审模式下不能结案）
- ❌ 不要调用 run_command

## 语言要求

所有输出使用中文。`
}
