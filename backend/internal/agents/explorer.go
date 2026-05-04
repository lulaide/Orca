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

// RunExplorer 启动 Explorer Agent 对指定 Investigation 进行诊断。
// Explorer 只做只读探索和诊断，不提修复方案。
func RunExplorer(db *gorm.DB, engine *llm.Engine, inv *core.Investigation) {
	log.Printf("Agents/Explorer: starting for investigation %s (%s)", inv.ID, inv.Title)

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()

	// 创建 Conversation 记录 Agent 的思考过程
	var convID string
	if conv, err := core.CreateConversation(db, "Explorer: "+inv.Title, "agent", ""); err != nil {
		log.Printf("Agents/Explorer: create conversation failed: %v", err)
	} else {
		convID = conv.ID
	}
	ctx = context.WithValue(ctx, tools.ConversationIDKey, convID)

	systemPrompt := buildExplorerPrompt(inv) + buildAgentContext(db, inv) + buildSkillContext(db)
	userMessage := fmt.Sprintf("请开始诊断调查 %s: %s", inv.ID, inv.Title)
	if inv.Description != "" {
		userMessage += "\n\n" + inv.Description
	}

	// 保存初始 user 消息
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
		log.Printf("Agents/Explorer: failed for investigation %s: %v", inv.ID, err)
		core.CreateEntry(db, inv.ID, "note", "Explorer Agent 执行失败: "+err.Error(), "ai")
		return
	}

	log.Printf("Agents/Explorer: completed for investigation %s (%d iterations, %d tokens)",
		inv.ID, result.Iterations, result.TotalTokens)
}

func buildExplorerPrompt(inv *core.Investigation) string {
	return fmt.Sprintf(`你是 Orca Explorer Agent — 专职诊断员。你的**唯一职责**是排查问题根因。

## 当前调查
- Investigation ID: %s
- 标题: %s
- 严重度: %s

## 你必须做的

1. 使用 K8s 只读工具探索集群状态：
   - get_pods — 查看 Pod 列表和状态
   - describe_resource — 查看资源详情
   - get_pod_logs — 查看 Pod 日志
   - get_events — 查看集群事件
   - get_node_status — 查看节点状态
2. 如果有相关 Skill，调用 read_skill(name) 获取排障手册，按手册排查
3. 将**每个重要发现**记录到时间线：add_investigation_entry(type="discovery")
4. 排查完成后提交**排查报告**：add_investigation_entry(type="report")
   - 报告必须包含：**根因判断** + **支撑证据** + **影响范围**
5. 提交报告后，调用 update_investigation_status 将状态设为 "explored"

## 你绝对不能做的

- ❌ 不要提出修复方案（那是 Generator 的工作）
- ❌ 不要执行任何写操作（restart/scale/delete 等）
- ❌ 不要调用 resolve_investigation
- ❌ 不要把状态设为 explored 以外的值
- ❌ 不要调用 run_command（bash 命令需要审批，无人值守模式下会卡死）
- ❌ 不要调用 submit_solution（那是 Generator 的工作）

## 语言要求

所有输出使用中文。工具参数中的 identifier（namespace/pod 名等）保留原样。

## Skill 技能系统

下方注入了"已知服务技能"列表。排查时先看有没有相关 skill：
- 有 → 调 read_skill(name) 加载排障手册，按手册排查
- 没有 → 正常排查`, inv.ID, inv.Title, inv.Severity)
}
