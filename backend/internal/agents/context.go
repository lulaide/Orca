// Package agents 实现多 Agent 排障流水线（Explorer → Generator → Evaluator）。
//
// 每个 Agent 由 Investigation 状态变更自动触发，通过时间线条目传递上下文。
package agents

import (
	"fmt"
	"strings"

	"gorm.io/gorm"

	"github.com/lulaide/orca/internal/core"
	"github.com/lulaide/orca/internal/knowledge"
)

// buildAgentContext 从 Investigation 时间线组装上下文，供下游 Agent 使用。
// 按 entry type 分组拼接，让 Agent 能看到前序阶段的完整发现。
func buildAgentContext(db *gorm.DB, inv *core.Investigation) string {
	entries, err := core.ListEntries(db, inv.ID)
	if err != nil || len(entries) == 0 {
		return ""
	}

	groups := map[string][]core.InvestigationEntry{}
	for _, e := range entries {
		groups[e.Type] = append(groups[e.Type], e)
	}

	var sb strings.Builder

	sb.WriteString(fmt.Sprintf("\n## 调查信息\n\n- ID: %s\n- 标题: %s\n- 严重度: %s\n- 状态: %s\n",
		inv.ID, inv.Title, inv.Severity, inv.Status))
	if inv.Description != "" {
		sb.WriteString(fmt.Sprintf("- 描述: %s\n", inv.Description))
	}

	writeSection := func(title, entryType string) {
		items, ok := groups[entryType]
		if !ok || len(items) == 0 {
			return
		}
		sb.WriteString(fmt.Sprintf("\n## %s\n\n", title))
		for _, e := range items {
			sb.WriteString(fmt.Sprintf("**[%s]** %s\n\n", e.CreatedAt.Format("15:04:05"), e.Content))
		}
	}

	writeSection("排查发现", "discovery")
	writeSection("执行操作", "action")
	writeSection("排查报告", "report")
	writeSection("修复方案", "solution")
	writeSection("评审反馈", "review")
	writeSection("验证结果", "verification")
	writeSection("备注", "note")

	return sb.String()
}

// buildSkillContext 注入 Skill Level 1 信息。
func buildSkillContext(db *gorm.DB) string {
	return knowledge.BuildSkillContext(db)
}
