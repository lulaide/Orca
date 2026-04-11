package db

import (
	"encoding/json"
	"errors"
	"time"

	"gorm.io/gorm"
)

// Setting 通用的 key-value 配置存储。
// 用途:持久化运行时可变的配置,如 LLM provider、kubeconfig 内容等。
// 启动时 main.go 从这里读取值覆盖 config.yaml 的 bootstrap 默认值。
type Setting struct {
	Key       string    `gorm:"primaryKey" json:"key"`
	Value     []byte    `gorm:"type:jsonb;not null" json:"-"`
	UpdatedAt time.Time `json:"updated_at"`
	UpdatedBy string    `json:"updated_by,omitempty"`
}

// TableName 固定表名,避免 GORM 复数化。
func (Setting) TableName() string {
	return "settings"
}

// GetSetting 按 key 读取原始 JSON 字节。
// 返回 (value, found, error)。
func GetSetting(db *gorm.DB, key string) ([]byte, bool, error) {
	var s Setting
	err := db.First(&s, "key = ?", key).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, err
	}
	return s.Value, true, nil
}

// LoadSetting 按 key 读取并 JSON unmarshal 到 dest。
// 返回 (found, error)。
// 典型用法:
//
//	var llmCfg llm.Config = bootstrapFromYAML
//	_, _ = db.LoadSetting(gormDB, "llm", &llmCfg)
//	// llmCfg 现在是 DB 值(如果存在)或 bootstrap 值
func LoadSetting(db *gorm.DB, key string, dest any) (bool, error) {
	raw, found, err := GetSetting(db, key)
	if err != nil || !found {
		return found, err
	}
	if err := json.Unmarshal(raw, dest); err != nil {
		return true, err
	}
	return true, nil
}

// SaveSetting JSON-marshal value 并 upsert 到 settings 表。
// updatedBy 建议填写调用者的用户 ID,审计用;无用户上下文时填 "system"。
func SaveSetting(db *gorm.DB, key string, value any, updatedBy string) error {
	raw, err := json.Marshal(value)
	if err != nil {
		return err
	}
	s := Setting{
		Key:       key,
		Value:     raw,
		UpdatedBy: updatedBy,
		UpdatedAt: time.Now(),
	}
	return db.Save(&s).Error
}

// DeleteSetting 删除某个 key,用于重置到 config.yaml 默认值。
func DeleteSetting(db *gorm.DB, key string) error {
	return db.Delete(&Setting{}, "key = ?", key).Error
}
