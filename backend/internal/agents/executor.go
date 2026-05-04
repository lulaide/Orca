package agents

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"strings"
	"time"

	"gorm.io/gorm"

	"github.com/lulaide/orca/internal/core"
	"github.com/lulaide/orca/internal/llm"
	"github.com/lulaide/orca/internal/tools"
)

// RunExecutor 从最新的 solution entry 解析 actions 并通过 Registry 执行。不走 LLM。
func RunExecutor(db *gorm.DB, _ *llm.Engine, inv *core.Investigation) {
	log.Printf("Agents/Executor: starting for investigation %s", inv.ID)

	entries, err := core.ListEntries(db, inv.ID)
	if err != nil {
		log.Printf("Agents/Executor: list entries failed: %v", err)
		return
	}

	// 找最新的 solution entry
	var payload tools.SolutionPayload
	found := false
	for i := len(entries) - 1; i >= 0; i-- {
		if entries[i].Type == "solution" {
			if err := json.Unmarshal([]byte(entries[i].Content), &payload); err != nil {
				log.Printf("Agents/Executor: parse solution JSON failed: %v", err)
				core.CreateEntry(db, inv.ID, "note", "方案格式解析失败: "+err.Error(), "ai")
				return
			}
			found = true
			break
		}
	}
	if !found || len(payload.Actions) == 0 {
		log.Printf("Agents/Executor: no actions found for investigation %s", inv.ID)
		core.CreateEntry(db, inv.ID, "note", "未找到可执行的操作", "ai")
		return
	}

	reg := tools.GetRegistry()
	if reg == nil {
		log.Printf("Agents/Executor: registry not available")
		core.CreateEntry(db, inv.ID, "note", "工具注册表不可用", "ai")
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	// 标记为已审批，绕过写工具的 approval 拦截
	ctx = context.WithValue(ctx, tools.PreApprovedKey, true)

	// 逐条执行
	var results []string
	allSuccess := true
	for _, action := range payload.Actions {
		if !reg.Has(action.Tool) {
			results = append(results, fmt.Sprintf("⏭ `%s` — 工具不存在，跳过", action.Tool))
			continue
		}

		log.Printf("Agents/Executor: executing tool %s(%s)", action.Tool, action.Args)
		output, err := reg.Execute(ctx, action.Tool, action.Args)
		if err != nil {
			allSuccess = false
			results = append(results, fmt.Sprintf("❌ `%s`\n```\n%s\n```", action.Tool, err.Error()))
			log.Printf("Agents/Executor: tool %s failed: %v", action.Tool, err)
		} else {
			result := strings.TrimSpace(output)
			if result == "" {
				result = "(无输出)"
			}
			results = append(results, fmt.Sprintf("✅ `%s`\n```\n%s\n```", action.Tool, result))
		}
	}

	summary := "## 执行结果\n\n" + strings.Join(results, "\n\n")
	if !allSuccess {
		summary += "\n\n⚠️ 部分操作执行失败"
	}
	core.CreateEntry(db, inv.ID, "action", summary, "ai")

	// 推进到 verifying
	core.UpdateInvestigationStatus(db, inv.ID, core.StatusVerifying, "ai")

	log.Printf("Agents/Executor: completed for investigation %s (actions: %d, all_success: %v)",
		inv.ID, len(payload.Actions), allSuccess)
}
