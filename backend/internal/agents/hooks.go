package agents

import (
	"log"

	"gorm.io/gorm"

	"github.com/lulaide/orca/internal/core"
	"github.com/lulaide/orca/internal/llm"
)

// Register 注册状态变更回调。只需两个 hook：
//  1. explored → 跑 Generate+Evaluate 循环
//  2. executing → 跑 Execute+Verify（失败则重新 Generate+Evaluate）
func Register(engine *llm.Engine) {
	core.RegisterStatusChangeHook(func(db *gorm.DB, inv *core.Investigation, oldStatus, newStatus string) {
		switch newStatus {
		case core.StatusExplored:
			log.Printf("Agents: investigation %s explored → starting solution pipeline", inv.ID)
			go RunSolutionPipeline(db, engine, inv)
		}
	})
}
