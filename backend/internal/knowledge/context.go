package knowledge

import (
	"encoding/json"
	"fmt"
	"strings"

	"gorm.io/gorm"

	"github.com/lulaide/orca/internal/core"
)


// BuildSkillContext 生成 Level 1 注入文本（所有 Agent 使用）。
// 只注入每个 skill 的 name + description，~80 tokens/skill。
func BuildSkillContext(db *gorm.DB) string {
	skills, err := core.ListSkills(db)
	if err != nil || len(skills) == 0 {
		return ""
	}

	var sb strings.Builder
	sb.WriteString("\n\n## 已知服务技能\n\n")
	for _, s := range skills {
		sb.WriteString(fmt.Sprintf("- **%s**: %s\n", s.Name, s.Description))
	}
	sb.WriteString("\n如需某个服务的详细排障信息，调用 read_skill(name) 获取。\n")
	return sb.String()
}

// BuildServiceContext 向后兼容别名。
func BuildServiceContext(db *gorm.DB) string {
	return BuildSkillContext(db)
}

// SkillRefNames 获取 skill 的 reference 文件名列表。
func SkillRefNames(skill *core.Skill) []string {
	if skill == nil || len(skill.References) == 0 {
		return nil
	}
	refs := make(map[string]string)
	json.Unmarshal(skill.References, &refs)
	names := make([]string, 0, len(refs))
	for k := range refs {
		names = append(names, k)
	}
	return names
}
