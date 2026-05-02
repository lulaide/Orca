package tools

import (
	"context"
	"fmt"
	"log"
	"sync"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"

	"github.com/lulaide/orca/internal/core"
)

// ApprovalManager 管理写操作的人工审批。
type ApprovalManager struct {
	mu      sync.Mutex
	pending map[string]chan bool
	db      *gorm.DB
}

// NewApprovalManager 创建审批管理器。
func NewApprovalManager(db *gorm.DB) *ApprovalManager {
	return &ApprovalManager{
		pending: make(map[string]chan bool),
		db:      db,
	}
}

// Approve 确认执行。
func (m *ApprovalManager) Approve(id, userID string) error {
	if err := core.ResolvePendingAction(m.db, id, "approved", userID, ""); err != nil {
		return err
	}
	m.mu.Lock()
	ch, ok := m.pending[id]
	m.mu.Unlock()
	if ok {
		ch <- true
	}
	return nil
}

// Reject 拒绝执行。
func (m *ApprovalManager) Reject(id, userID string) error {
	if err := core.ResolvePendingAction(m.db, id, "rejected", userID, ""); err != nil {
		return err
	}
	m.mu.Lock()
	ch, ok := m.pending[id]
	m.mu.Unlock()
	if ok {
		ch <- false
	}
	return nil
}

// 全局审批管理器
var ApprovalMgr *ApprovalManager

// RequestApproval 写工具的通用审批入口。
// 1. 创建 PendingAction 存 DB
// 2. 通过 SSE 推审批事件给前端
// 3. 阻塞等用户确认/拒绝
// 4. 返回 approved/rejected
func RequestApproval(ctx context.Context, toolName, toolInput, description, risk string) (bool, error) {
	if ApprovalMgr == nil {
		return false, fmt.Errorf("approval manager not initialized")
	}

	actionID := uuid.NewString()
	action := &core.PendingAction{
		ID:             actionID,
		ConversationID: ConversationIDFromContext(ctx),
		ToolName:       toolName,
		ToolInput:      toolInput,
		Description:    description,
		Risk:           risk,
		Status:         "pending",
		CreatedAt:      time.Now(),
	}
	if err := core.CreatePendingAction(ApprovalMgr.db, action); err != nil {
		return false, err
	}

	// 创建等待 channel
	ch := make(chan bool, 1)
	ApprovalMgr.mu.Lock()
	ApprovalMgr.pending[actionID] = ch
	ApprovalMgr.mu.Unlock()

	defer func() {
		ApprovalMgr.mu.Lock()
		delete(ApprovalMgr.pending, actionID)
		ApprovalMgr.mu.Unlock()
	}()

	// 通过 SSE 推审批事件给前端（阻塞前）
	if emit := SSEEmitFromContext(ctx); emit != nil {
		_ = emit("approval_required", map[string]string{
			"id":          actionID,
			"tool_name":   toolName,
			"description": description,
			"risk":        risk,
		})
		log.Printf("Approval: waiting for %s (%s)", toolName, actionID)
	}

	// 阻塞等待
	select {
	case approved := <-ch:
		if !approved {
			log.Printf("Approval: %s rejected", actionID)
		} else {
			log.Printf("Approval: %s approved", actionID)
		}
		return approved, nil
	case <-ctx.Done():
		core.ResolvePendingAction(ApprovalMgr.db, actionID, "rejected", "", "context cancelled")
		return false, ctx.Err()
	}
}
