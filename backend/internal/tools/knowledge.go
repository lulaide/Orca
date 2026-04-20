package tools

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/cloudwego/eino/schema"

	"github.com/lulaide/orca/internal/core"
	"github.com/lulaide/orca/internal/knowledge"
)

// RegisterKnowledgeTools 注册知识库相关的 LLM 工具。
func RegisterKnowledgeTools(reg *Registry) {
	reg.Register(listKnowledgePagesInfo(), handleListKnowledgePages)
	reg.Register(writeKnowledgePageInfo(), handleWriteKnowledgePage)
}

// ---- list_knowledge_pages ----

func listKnowledgePagesInfo() *schema.ToolInfo {
	return &schema.ToolInfo{
		Name: "list_knowledge_pages",
		Desc: `列出知识库中已有的文档页面目录（slug + title + parent）。
用于了解当前知识库结构，避免重复创建已有页面。`,
		ParamsOneOf: schema.NewParamsOneOfByParams(map[string]*schema.ParameterInfo{}),
	}
}

func handleListKnowledgePages(ctx context.Context, args string) (string, error) {
	db, err := investigationDB()
	if err != nil {
		return "", err
	}
	pages, err := knowledge.ListPages(db)
	if err != nil {
		return "", err
	}
	if len(pages) == 0 {
		return "知识库为空，还没有任何文档。", nil
	}
	type brief struct {
		Slug       string `json:"slug"`
		Title      string `json:"title"`
		ParentSlug string `json:"parent_slug,omitempty"`
		SortOrder  int    `json:"sort_order"`
	}
	out := make([]brief, len(pages))
	for i, p := range pages {
		out[i] = brief{Slug: p.Slug, Title: p.Title, ParentSlug: p.ParentSlug, SortOrder: p.SortOrder}
	}
	j, _ := json.Marshal(out)
	return string(j), nil
}

// ---- write_knowledge_page ----

func writeKnowledgePageInfo() *schema.ToolInfo {
	return &schema.ToolInfo{
		Name: "write_knowledge_page",
		Desc: `创建或更新知识库中的一篇文档页面。

每篇文档有一个唯一的 slug（路径标识），通过 parent_slug 组成树形结构。

建议的文档结构：
- "overview" — 集群概述（顶级，parent_slug 为空）
- "architecture" — 服务架构与关系（顶级）
- "ns/{namespace}" — 各 namespace 概述
- "svc/{namespace}/{name}" — 各服务详情

content 字段使用 Markdown 格式，请写出完整、结构化的文档内容。`,
		ParamsOneOf: schema.NewParamsOneOfByParams(map[string]*schema.ParameterInfo{
			"slug": {
				Type:     schema.String,
				Desc:     `页面唯一路径标识，如 "overview"、"ns/kube-system"、"svc/kube-system/coredns"`,
				Required: true,
			},
			"title": {
				Type:     schema.String,
				Desc:     "页面标题（中文）",
				Required: true,
			},
			"content": {
				Type:     schema.String,
				Desc:     "页面内容（Markdown 格式，中文）",
				Required: true,
			},
			"parent_slug": {
				Type:     schema.String,
				Desc:     `父页面 slug。顶级页面留空。namespace 页面的 parent 通常是 "overview"，服务页面的 parent 是对应的 "ns/{namespace}"`,
				Required: false,
			},
			"sort_order": {
				Type:     schema.Integer,
				Desc:     "同级排序权重（0 最前），默认 0",
				Required: false,
			},
		}),
	}
}

type writePageArgs struct {
	Slug       string `json:"slug"`
	Title      string `json:"title"`
	Content    string `json:"content"`
	ParentSlug string `json:"parent_slug"`
	SortOrder  int    `json:"sort_order"`
}

func handleWriteKnowledgePage(ctx context.Context, args string) (string, error) {
	db, err := investigationDB()
	if err != nil {
		return "", err
	}
	var p writePageArgs
	if err := json.Unmarshal([]byte(args), &p); err != nil {
		return "", fmt.Errorf("invalid args: %w", err)
	}
	if p.Slug == "" || p.Title == "" {
		return "", fmt.Errorf("slug and title are required")
	}

	page := &core.KnowledgePage{
		Slug:       p.Slug,
		Title:      p.Title,
		Content:    p.Content,
		ParentSlug: p.ParentSlug,
		SortOrder:  p.SortOrder,
		UpdatedAt:  time.Now(),
	}
	if err := knowledge.UpsertPage(db, page); err != nil {
		return "", fmt.Errorf("upsert page: %w", err)
	}
	return fmt.Sprintf("已写入文档：%s（%s）", p.Title, p.Slug), nil
}
