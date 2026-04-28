package core

import (
	"encoding/json"
	"errors"

	"gorm.io/datatypes"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// ListSkills 返回所有 skill 的摘要（name + description），按 name 排序。
func ListSkills(db *gorm.DB) ([]Skill, error) {
	var out []Skill
	if err := db.Order("name ASC").Find(&out).Error; err != nil {
		return nil, err
	}
	return out, nil
}

// GetSkill 按 name 查找单个 skill。
func GetSkill(db *gorm.DB, name string) (*Skill, error) {
	var s Skill
	if err := db.Where("name = ?", name).First(&s).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, err
	}
	return &s, nil
}

// UpsertSkill 创建或更新 skill（全量写入，Knowledge Agent 用）。
func UpsertSkill(db *gorm.DB, s *Skill) error {
	if s.Name == "" {
		return errors.New("skill name is required")
	}
	if s.References == nil {
		s.References = datatypes.JSON([]byte("{}"))
	}
	if s.Metadata == nil {
		s.Metadata = datatypes.JSON([]byte("{}"))
	}
	return db.Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "name"}},
		DoUpdates: clause.AssignmentColumns([]string{"description", "content", "references", "metadata", "updated_at"}),
	}).Create(s).Error
}

// WriteSkillRef 创建或更新 skill 的某个 reference 文件。
func WriteSkillRef(db *gorm.DB, name, refName, content string) error {
	skill, err := GetSkill(db, name)
	if err != nil {
		return err
	}
	if skill == nil {
		return errors.New("skill not found: " + name)
	}

	refs := make(map[string]string)
	if len(skill.References) > 0 {
		json.Unmarshal(skill.References, &refs)
	}
	refs[refName] = content

	b, _ := json.Marshal(refs)
	return db.Model(&Skill{}).Where("name = ?", name).
		Update("references", datatypes.JSON(b)).Error
}

// GetSkillRef 读取 skill 的某个 reference 文件内容。
func GetSkillRef(db *gorm.DB, name, refName string) (string, error) {
	skill, err := GetSkill(db, name)
	if err != nil {
		return "", err
	}
	if skill == nil {
		return "", errors.New("skill not found: " + name)
	}

	refs := make(map[string]string)
	if len(skill.References) > 0 {
		json.Unmarshal(skill.References, &refs)
	}

	content, ok := refs[refName]
	if !ok {
		return "", errors.New("reference not found: " + refName)
	}
	return content, nil
}

// AppendSkillSection 追加内容到某个 reference（用于 incidents 积累）。
// 如果 reference 不存在则创建。
func AppendSkillSection(db *gorm.DB, name, refName, content string) error {
	skill, err := GetSkill(db, name)
	if err != nil {
		return err
	}
	if skill == nil {
		return errors.New("skill not found: " + name)
	}

	refs := make(map[string]string)
	if len(skill.References) > 0 {
		json.Unmarshal(skill.References, &refs)
	}

	existing := refs[refName]
	if existing != "" {
		refs[refName] = existing + "\n\n" + content
	} else {
		refs[refName] = content
	}

	b, _ := json.Marshal(refs)
	return db.Model(&Skill{}).Where("name = ?", name).
		Update("references", datatypes.JSON(b)).Error
}

// DeleteSkill 删除 skill。
func DeleteSkill(db *gorm.DB, name string) error {
	return db.Where("name = ?", name).Delete(&Skill{}).Error
}

// DeleteSkillRef 删除 skill 的某个 reference。
func DeleteSkillRef(db *gorm.DB, name, refName string) error {
	skill, err := GetSkill(db, name)
	if err != nil {
		return err
	}
	if skill == nil {
		return errors.New("skill not found: " + name)
	}

	refs := make(map[string]string)
	if len(skill.References) > 0 {
		json.Unmarshal(skill.References, &refs)
	}
	delete(refs, refName)

	b, _ := json.Marshal(refs)
	return db.Model(&Skill{}).Where("name = ?", name).
		Update("references", datatypes.JSON(b)).Error
}
