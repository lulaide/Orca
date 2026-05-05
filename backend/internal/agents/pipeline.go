package agents

import (
	"log"

	"gorm.io/gorm"

	"github.com/lulaide/orca/internal/core"
	"github.com/lulaide/orca/internal/llm"
	"github.com/lulaide/orca/internal/tools"
)

const maxRetries = 3

// RunSolutionPipeline 在 explored 后执行：Generator → Evaluator 循环，直到 awaiting_approval 或达到最大重试。
func RunSolutionPipeline(db *gorm.DB, engine *llm.Engine, inv *core.Investigation) {
	for i := 0; i < maxRetries; i++ {
		RunGenerator(db, engine, inv)

		fresh, err := core.GetInvestigation(db, inv.ID)
		if err != nil {
			log.Printf("Agents/Pipeline: get investigation failed: %v", err)
			return
		}
		if fresh.Status != core.StatusEvaluating {
			log.Printf("Agents/Pipeline: unexpected status after Generator: %s", fresh.Status)
			return
		}

		RunEvaluator(db, engine, fresh)

		fresh, err = core.GetInvestigation(db, inv.ID)
		if err != nil {
			log.Printf("Agents/Pipeline: get investigation failed: %v", err)
			return
		}

		switch fresh.Status {
		case core.StatusAwaitingApproval:
			log.Printf("Agents/Pipeline: investigation %s → awaiting_approval", inv.ID)
			// 发送飞书审批通知
			if tools.NotifyMgr != nil {
				tools.NotifyMgr.NotifyApprovalRequired(fresh)
			}
			return
		case core.StatusGenerating:
			log.Printf("Agents/Pipeline: Evaluator rejected, retrying (%d/%d)", i+1, maxRetries)
			inv = fresh
			continue
		default:
			log.Printf("Agents/Pipeline: unexpected status after Evaluator: %s", fresh.Status)
			return
		}
	}

	log.Printf("Agents/Pipeline: investigation %s reached max retries", inv.ID)
	core.CreateEntry(db, inv.ID, "note", "方案生成已达最大重试次数，需要人工介入", "ai")
}

// RunExecutionPipeline 在用户审批后执行：直接执行 commands → Verifier 验证。
// 验证失败则重新走 SolutionPipeline。
func RunExecutionPipeline(db *gorm.DB, engine *llm.Engine, inv *core.Investigation) {
	// 1. 直接执行 solution 中的 commands
	RunExecutor(db, engine, inv)

	fresh, err := core.GetInvestigation(db, inv.ID)
	if err != nil {
		log.Printf("Agents/Pipeline: get investigation failed: %v", err)
		return
	}
	if fresh.Status != core.StatusVerifying {
		log.Printf("Agents/Pipeline: unexpected status after Executor: %s", fresh.Status)
		return
	}

	// 2. Evaluator（验证模式）检查修复结果
	RunEvaluator(db, engine, fresh)

	fresh, err = core.GetInvestigation(db, inv.ID)
	if err != nil {
		log.Printf("Agents/Pipeline: get investigation failed: %v", err)
		return
	}

	switch fresh.Status {
	case core.StatusResolved:
		log.Printf("Agents/Pipeline: investigation %s resolved!", inv.ID)
	case core.StatusGenerating:
		log.Printf("Agents/Pipeline: verify failed, re-entering solution pipeline")
		RunSolutionPipeline(db, engine, fresh)
	default:
		log.Printf("Agents/Pipeline: unexpected status after Verifier: %s", fresh.Status)
	}
}
