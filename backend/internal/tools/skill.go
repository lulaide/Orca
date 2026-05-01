package tools

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/cloudwego/eino/schema"
	"gorm.io/datatypes"

	"github.com/lulaide/orca/internal/core"
)

// RegisterSkillTools 注册所有 Agent 共用的 Skill 读取 + 学习更新工具。
func RegisterSkillTools(reg *Registry) {
	reg.Register(readSkillInfo(), handleReadSkill)
	reg.Register(readSkillRefInfo(), handleReadSkillRef)
	reg.Register(updateSkillSectionInfo(), handleUpdateSkillSection)
}

// RegisterSkillWriteTools 注册 Knowledge Agent 专用的 Skill 写入工具。
func RegisterSkillWriteTools(reg *Registry) {
	reg.Register(writeSkillInfo(), handleWriteSkill)
	reg.Register(writeSkillRefInfo(), handleWriteSkillRef)
	reg.Register(deleteSkillInfo(), handleDeleteSkill)
}

// ---- read_skill ----

func readSkillInfo() *schema.ToolInfo {
	return &schema.ToolInfo{
		Name: "read_skill",
		Desc: `读取某个服务技能的完整内容（Level 2）。
返回技能的核心文档（排障手册、组件信息等）以及可用的 reference 文件列表。
如需某个 reference 的详细内容，再调用 read_skill_ref。`,
		ParamsOneOf: schema.NewParamsOneOfByParams(map[string]*schema.ParameterInfo{
			"name": {
				Type:     schema.String,
				Desc:     "技能名称，如 authentik、gitea",
				Required: true,
			},
		}),
	}
}

func handleReadSkill(ctx context.Context, args string) (string, error) {
	db, err := investigationDB()
	if err != nil {
		return "", err
	}
	var p struct{ Name string `json:"name"` }
	if err := json.Unmarshal([]byte(args), &p); err != nil {
		return "", fmt.Errorf("invalid args: %w", err)
	}

	skill, err := core.GetSkill(db, p.Name)
	if err != nil {
		return "", err
	}
	if skill == nil {
		return fmt.Sprintf("未找到技能: %s", p.Name), nil
	}

	// 提取 reference + script 文件名列表
	refs := make(map[string]string)
	if len(skill.References) > 0 {
		json.Unmarshal(skill.References, &refs)
	}
	refNames := make([]string, 0, len(refs))
	for k := range refs {
		refNames = append(refNames, k)
	}

	scripts := make(map[string]string)
	if len(skill.Scripts) > 0 {
		json.Unmarshal(skill.Scripts, &scripts)
	}
	scriptNames := make([]string, 0, len(scripts))
	for k := range scripts {
		scriptNames = append(scriptNames, k)
	}

	result := struct {
		Name        string   `json:"name"`
		Description string   `json:"description"`
		Content     string   `json:"content"`
		RefFiles    []string `json:"reference_files"`
		ScriptFiles []string `json:"script_files"`
	}{
		Name:        skill.Name,
		Description: skill.Description,
		Content:     skill.Content,
		RefFiles:    refNames,
		ScriptFiles: scriptNames,
	}

	j, _ := json.Marshal(result)
	return string(j), nil
}

// ---- read_skill_ref ----

func readSkillRefInfo() *schema.ToolInfo {
	return &schema.ToolInfo{
		Name: "read_skill_ref",
		Desc: `读取技能的某个 reference 或 script 文件内容（Level 3 深度参考）。
比如架构图（architecture.md）、历史事件（incidents.md）、脚本（extract.py）等。
先调用 read_skill 查看有哪些 reference_files 和 script_files 可用。`,
		ParamsOneOf: schema.NewParamsOneOfByParams(map[string]*schema.ParameterInfo{
			"name": {
				Type:     schema.String,
				Desc:     "技能名称",
				Required: true,
			},
			"ref": {
				Type:     schema.String,
				Desc:     "reference 文件名，如 architecture.md、incidents.md",
				Required: true,
			},
		}),
	}
}

func handleReadSkillRef(ctx context.Context, args string) (string, error) {
	db, err := investigationDB()
	if err != nil {
		return "", err
	}
	var p struct {
		Name string `json:"name"`
		Ref  string `json:"ref"`
	}
	if err := json.Unmarshal([]byte(args), &p); err != nil {
		return "", fmt.Errorf("invalid args: %w", err)
	}

	content, err := core.GetSkillRef(db, p.Name, p.Ref)
	if err != nil {
		return "", err
	}
	return content, nil
}

// ---- update_skill_section ----

func updateSkillSectionInfo() *schema.ToolInfo {
	return &schema.ToolInfo{
		Name: "update_skill_section",
		Desc: `向技能的某个 reference 文件追加内容。主要用于排查结束后记录经验。
如果 reference 文件不存在会自动创建。
典型用法：调查解决后，调用 update_skill_section(name, "incidents.md", "### 事件标题\n- 现象: ...\n- 原因: ...\n- 解决: ...")`,
		ParamsOneOf: schema.NewParamsOneOfByParams(map[string]*schema.ParameterInfo{
			"name": {
				Type:     schema.String,
				Desc:     "技能名称",
				Required: true,
			},
			"ref": {
				Type:     schema.String,
				Desc:     "reference 文件名，如 incidents.md",
				Required: true,
			},
			"content": {
				Type:     schema.String,
				Desc:     "要追加的内容（Markdown）",
				Required: true,
			},
		}),
	}
}

func handleUpdateSkillSection(ctx context.Context, args string) (string, error) {
	db, err := investigationDB()
	if err != nil {
		return "", err
	}
	var p struct {
		Name    string `json:"name"`
		Ref     string `json:"ref"`
		Content string `json:"content"`
	}
	if err := json.Unmarshal([]byte(args), &p); err != nil {
		return "", fmt.Errorf("invalid args: %w", err)
	}

	// installed 类型的 skill 不允许 Agent 修改
	skill, _ := core.GetSkill(db, p.Name)
	if skill != nil && skill.Type == "installed" {
		return "该技能来自 Marketplace，不允许修改。请创建自定义技能记录你的经验。", nil
	}

	if err := core.AppendSkillSection(db, p.Name, p.Ref, p.Content); err != nil {
		return "", err
	}
	return fmt.Sprintf("已更新技能 %s 的 %s", p.Name, p.Ref), nil
}

// ---- write_skill (Knowledge Agent 专用) ----

func writeSkillInfo() *schema.ToolInfo {
	return &schema.ToolInfo{
		Name: "write_skill",
		Desc: `创建或完全更新一个服务技能。Knowledge Agent 扫描集群时使用。

name: 服务标识（小写短横线，如 authentik、cluster-overview）
description: 一句话描述，会注入所有 Agent 的 system prompt（<150 字）
  - 要写清楚：这个服务是什么、什么场景下应该使用这个技能
content: SKILL.md body，核心文档内容（<5000 tokens）
  - 应包含排障时最需要的信息：概述、组件、关键配置、排障手册
  - 详细内容拆到 reference 文件，用 write_skill_ref 写入
metadata: 可选 JSON，包含 namespace/type/dependencies/dependents/domains/ports 等`,
		ParamsOneOf: schema.NewParamsOneOfByParams(map[string]*schema.ParameterInfo{
			"name": {
				Type:     schema.String,
				Desc:     "技能名称（小写，短横线分隔）",
				Required: true,
			},
			"description": {
				Type:     schema.String,
				Desc:     "一句话描述（注入 system prompt，<150 字）",
				Required: true,
			},
			"content": {
				Type:     schema.String,
				Desc:     "SKILL.md body（Markdown，中文）",
				Required: true,
			},
			"metadata": {
				Type:     schema.String,
				Desc:     "可选 JSON 元数据",
				Required: false,
			},
		}),
	}
}

func handleWriteSkill(ctx context.Context, args string) (string, error) {
	db, err := investigationDB()
	if err != nil {
		return "", err
	}
	var p struct {
		Name        string `json:"name"`
		Description string `json:"description"`
		Content     string `json:"content"`
		Metadata    string `json:"metadata"`
	}
	if err := json.Unmarshal([]byte(args), &p); err != nil {
		return "", fmt.Errorf("invalid args: %w", err)
	}

	// installed 类型不允许 Agent 覆盖
	existing, _ := core.GetSkill(db, p.Name)
	if existing != nil && existing.Type == "installed" {
		return "该技能来自 Marketplace，不允许修改。", nil
	}

	// 保留已有的 references（不覆盖 Agent 积累的经验）
	var existingRefs datatypes.JSON
	if existing != nil && len(existing.References) > 0 {
		existingRefs = existing.References
	} else {
		existingRefs = datatypes.JSON([]byte("{}"))
	}

	var meta datatypes.JSON
	if p.Metadata != "" {
		meta = datatypes.JSON(p.Metadata)
	} else {
		meta = datatypes.JSON([]byte("{}"))
	}

	skill := &core.Skill{
		Name:        p.Name,
		Description: p.Description,
		Content:     p.Content,
		References:  existingRefs,
		Metadata:    meta,
	}
	if err := core.UpsertSkill(db, skill); err != nil {
		return "", fmt.Errorf("upsert skill: %w", err)
	}
	return fmt.Sprintf("已写入技能: %s", p.Name), nil
}

// ---- write_skill_ref (Knowledge Agent 专用) ----

func writeSkillRefInfo() *schema.ToolInfo {
	return &schema.ToolInfo{
		Name: "write_skill_ref",
		Desc: `创建或更新技能的某个 reference 文件。
用于写入架构图、详细组件说明等深度参考材料。
文件名自由命名（如 architecture.md、oauth-flow.md）。`,
		ParamsOneOf: schema.NewParamsOneOfByParams(map[string]*schema.ParameterInfo{
			"name": {
				Type:     schema.String,
				Desc:     "技能名称",
				Required: true,
			},
			"ref": {
				Type:     schema.String,
				Desc:     "reference 文件名",
				Required: true,
			},
			"content": {
				Type:     schema.String,
				Desc:     "文件内容（Markdown）",
				Required: true,
			},
		}),
	}
}

func handleWriteSkillRef(ctx context.Context, args string) (string, error) {
	db, err := investigationDB()
	if err != nil {
		return "", err
	}
	var p struct {
		Name    string `json:"name"`
		Ref     string `json:"ref"`
		Content string `json:"content"`
	}
	if err := json.Unmarshal([]byte(args), &p); err != nil {
		return "", fmt.Errorf("invalid args: %w", err)
	}

	if err := core.WriteSkillRef(db, p.Name, p.Ref, p.Content); err != nil {
		return "", err
	}
	return fmt.Sprintf("已写入技能 %s 的 reference: %s", p.Name, p.Ref), nil
}

// ---- delete_skill (Knowledge Agent 专用) ----

func deleteSkillInfo() *schema.ToolInfo {
	return &schema.ToolInfo{
		Name: "delete_skill",
		Desc: "删除一个已过期或不再需要的技能。",
		ParamsOneOf: schema.NewParamsOneOfByParams(map[string]*schema.ParameterInfo{
			"name": {
				Type:     schema.String,
				Desc:     "技能名称",
				Required: true,
			},
		}),
	}
}

func handleDeleteSkill(ctx context.Context, args string) (string, error) {
	db, err := investigationDB()
	if err != nil {
		return "", err
	}
	var p struct{ Name string `json:"name"` }
	if err := json.Unmarshal([]byte(args), &p); err != nil {
		return "", fmt.Errorf("invalid args: %w", err)
	}

	if err := core.DeleteSkill(db, p.Name); err != nil {
		return "", err
	}
	return fmt.Sprintf("已删除技能: %s", p.Name), nil
}
