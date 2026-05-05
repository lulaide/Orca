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

// RunGenerator 启动 Generator Agent，基于 Explorer 的排查报告生成修复方案。
func RunGenerator(db *gorm.DB, engine *llm.Engine, inv *core.Investigation) {
	log.Printf("Agents/Generator: starting for investigation %s (%s)", inv.ID, inv.Title)

	// 先把状态推到 generating
	core.UpdateInvestigationStatus(db, inv.ID, core.StatusGenerating, "ai")

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()

	var convID string
	if conv, err := core.CreateConversation(db, "Generator: "+inv.Title, "agent", ""); err != nil {
		log.Printf("Agents/Generator: create conversation failed: %v", err)
	} else {
		convID = conv.ID
	}
	ctx = context.WithValue(ctx, tools.ConversationIDKey, convID)

	agentContext := buildAgentContext(db, inv)
	systemPrompt := buildGeneratorPrompt(inv) + agentContext + buildSkillContext(db)
	userMessage := fmt.Sprintf("请基于排查报告为调查 %s 生成修复方案。", inv.ID)

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
		log.Printf("Agents/Generator: failed for investigation %s: %v", inv.ID, err)
		core.CreateEntry(db, inv.ID, "note", "Generator Agent 执行失败: "+err.Error(), "ai")
		return
	}

	log.Printf("Agents/Generator: completed for investigation %s (%d iterations, %d tokens)",
		inv.ID, result.Iterations, result.TotalTokens)
}

func buildGeneratorPrompt(inv *core.Investigation) string {
	return fmt.Sprintf(`你是 Orca Generator Agent — 专职方案生成员。你的**唯一职责**是基于排查报告提出修复方案。

## 当前调查
- Investigation ID: %s
- 标题: %s
- 严重度: %s

## 输入

下方注入了 Explorer 的排查发现和报告，请仔细阅读后提出方案。

## 你必须做的

1. 仔细阅读下方的"排查报告"和"排查发现"
2. 基于报告中的**根因**，提出具体可执行的修复方案
3. 调用 **submit_solution** 工具提交方案，参数：
   - description: 方案说明（包含预期效果和风险评估，Markdown 格式，给人看的）
   - commands: 要执行的命令数组（只能是 kubectl/helm 命令，用户审批后会被**直接自动执行**）
4. 如果有之前被拒绝的方案和评审反馈（见下方"评审反馈"），**必须针对反馈改进**
5. 提交方案后，调用 update_investigation_status 将状态设为 "evaluating"

## 关于 actions 数组（重要）

actions 里的每个操作在用户审批后会通过内置工具**自动执行**。每个 action 是：
- tool: 工具名（见下方列表）
- args: JSON 字符串，对应工具的参数

可用的写操作工具（注意字段名必须严格匹配）：
- **scale_deployment**: {"namespace":"...","name":"...","replicas":N} — 调整副本数
- **restart_deployment**: {"namespace":"...","name":"..."} — 滚动重启
- **delete_pod**: {"namespace":"...","name":"..."} — 删除 Pod
- **rollback_deployment**: {"namespace":"...","name":"..."} — 回滚到上一版本
- **cordon_node**: {"name":"..."} — 标记节点不可调度
- **uncordon_node**: {"name":"..."} — 取消节点不可调度

⚠️ 所有工具的资源名参数统一用 "name"，不要用 "deployment"/"pod"/"node" 等别名！

示例：
submit_solution(
  investigation_id="xxx",
  description="将 podinfo 扩容到 2 个副本以恢复服务",
  actions=[{"tool":"scale_deployment","args":"{\"namespace\":\"demo\",\"name\":\"podinfo\",\"replicas\":2}"}]
)

## 你绝对不能做的

- ❌ 不要自己排查集群（那是 Explorer 的工作）
- ❌ 不要直接调用写工具（scale_deployment/restart_deployment 等）— 只能通过 submit_solution 的 actions 列出
- ❌ 不要调用 resolve_investigation
- ❌ 不要调用 run_command
- ❌ 不要用 add_investigation_entry(type="solution")，用 submit_solution 代替

## 语言要求

所有输出使用中文。命令和 YAML 中的技术标识符保留原样。

## Skill 技能系统

下方注入了"已知服务技能"列表。如果相关服务有 Skill，调用 read_skill(name) 查看是否有推荐的修复流程。`, inv.ID, inv.Title, inv.Severity)
}
