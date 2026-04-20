package knowledge

import (
	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"github.com/lulaide/orca/internal/core"
)

// UpsertPage 创建或更新一篇知识页面。
func UpsertPage(db *gorm.DB, page *core.KnowledgePage) error {
	return db.Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "slug"}},
		DoUpdates: clause.AssignmentColumns([]string{"title", "content", "parent_slug", "sort_order", "updated_at"}),
	}).Create(page).Error
}

// ListPages 列出所有页面，按 parent_slug + sort_order 排序。
func ListPages(db *gorm.DB) ([]core.KnowledgePage, error) {
	var out []core.KnowledgePage
	if err := db.Order("parent_slug ASC, sort_order ASC, slug ASC").Find(&out).Error; err != nil {
		return nil, err
	}
	return out, nil
}

// GetPage 按 slug 查单个。
func GetPage(db *gorm.DB, slug string) (*core.KnowledgePage, error) {
	var p core.KnowledgePage
	if err := db.First(&p, "slug = ?", slug).Error; err != nil {
		return nil, err
	}
	return &p, nil
}

// UpdatePageContent 人工编辑页面内容。
func UpdatePageContent(db *gorm.DB, slug, content string) (*core.KnowledgePage, error) {
	if err := db.Model(&core.KnowledgePage{}).Where("slug = ?", slug).
		Update("content", content).Error; err != nil {
		return nil, err
	}
	return GetPage(db, slug)
}

// DeleteAllPages 清空所有知识页面（重新扫描前用）。
func DeleteAllPages(db *gorm.DB) error {
	return db.Where("1=1").Delete(&core.KnowledgePage{}).Error
}
