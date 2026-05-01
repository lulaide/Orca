package core

import (
	"errors"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// ListPatrolConfigs 列出所有巡检配置。
func ListPatrolConfigs(db *gorm.DB) ([]PatrolConfig, error) {
	var out []PatrolConfig
	if err := db.Order("created_at ASC").Find(&out).Error; err != nil {
		return nil, err
	}
	return out, nil
}

// GetPatrolConfig 按 ID 查找。
func GetPatrolConfig(db *gorm.DB, id string) (*PatrolConfig, error) {
	var c PatrolConfig
	if err := db.Where("id = ?", id).First(&c).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, err
	}
	return &c, nil
}

// CreatePatrolConfig 创建巡检配置。
func CreatePatrolConfig(db *gorm.DB, c *PatrolConfig) error {
	if c.Name == "" || c.Schedule == "" || c.Prompt == "" {
		return errors.New("name, schedule, and prompt are required")
	}
	if c.ID == "" {
		c.ID = uuid.NewString()
	}
	if c.Severity == "" {
		c.Severity = "warning"
	}
	return db.Create(c).Error
}

// UpdatePatrolConfig 更新巡检配置。
func UpdatePatrolConfig(db *gorm.DB, id string, patch map[string]any) (*PatrolConfig, error) {
	c, err := GetPatrolConfig(db, id)
	if err != nil || c == nil {
		return nil, errors.New("patrol config not found")
	}
	if err := db.Model(c).Updates(patch).Error; err != nil {
		return nil, err
	}
	return c, nil
}

// DeletePatrolConfig 删除巡检配置及其运行记录。
func DeletePatrolConfig(db *gorm.DB, id string) error {
	db.Where("patrol_id = ?", id).Delete(&PatrolRun{})
	return db.Where("id = ?", id).Delete(&PatrolConfig{}).Error
}

// MarkPatrolRun 更新巡检的 last_run_at。
func MarkPatrolRun(db *gorm.DB, id string) {
	now := time.Now()
	db.Model(&PatrolConfig{}).Where("id = ?", id).Update("last_run_at", &now)
}

// CreatePatrolRun 创建巡检运行记录。
func CreatePatrolRun(db *gorm.DB, r *PatrolRun) error {
	if r.ID == "" {
		r.ID = uuid.NewString()
	}
	return db.Create(r).Error
}

// UpdatePatrolRun 更新运行记录状态。
func UpdatePatrolRun(db *gorm.DB, id string, status string, duration int, errMsg string) {
	db.Model(&PatrolRun{}).Where("id = ?", id).Updates(map[string]any{
		"status":   status,
		"duration": duration,
		"error":    errMsg,
	})
}

// ListPatrolRuns 列出某个巡检的运行历史。
func ListPatrolRuns(db *gorm.DB, patrolID string, limit int) ([]PatrolRun, error) {
	if limit <= 0 {
		limit = 20
	}
	var out []PatrolRun
	if err := db.Where("patrol_id = ?", patrolID).
		Order("created_at DESC").Limit(limit).Find(&out).Error; err != nil {
		return nil, err
	}
	return out, nil
}
