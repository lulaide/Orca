package core

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// CreatePendingAction 创建审批记录。
func CreatePendingAction(db *gorm.DB, a *PendingAction) error {
	if a.ID == "" {
		a.ID = uuid.NewString()
	}
	if a.Status == "" {
		a.Status = "pending"
	}
	return db.Create(a).Error
}

// ResolvePendingAction 更新审批结果。
func ResolvePendingAction(db *gorm.DB, id, status, approvedBy, output string) error {
	now := time.Now()
	return db.Model(&PendingAction{}).Where("id = ?", id).Updates(map[string]any{
		"status":      status,
		"approved_by": approvedBy,
		"tool_output": output,
		"resolved_at": &now,
	}).Error
}

// GetPendingAction 查找审批记录。
func GetPendingAction(db *gorm.DB, id string) (*PendingAction, error) {
	var a PendingAction
	if err := db.Where("id = ?", id).First(&a).Error; err != nil {
		return nil, err
	}
	return &a, nil
}
