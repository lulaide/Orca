package tools

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/cloudwego/eino/schema"
	"gorm.io/gorm"

	"github.com/lulaide/orca/internal/core"
)

// DB 全局数据库句柄，由 main.go 启动时赋值。
// Investigation 工具的 handler 直接读它做 CRUD。
var DB *gorm.DB

// RegisterInvestigationTools 注册 Investigation 相关的 LLM 工具。
// 不含归档/删除——归档由人工决定，避免 LLM 幻觉误操作。
func RegisterInvestigationTools(reg *Registry) {
	reg.Register(createInvestigationInfo(), handleCreateInvestigation)
	reg.Register(addInvestigationEntryInfo(), handleAddInvestigationEntry)
	reg.Register(resolveInvestigationInfo(), handleResolveInvestigation)
}

func investigationDB() (*gorm.DB, error) {
	if DB == nil {
		return nil, errors.New("database is not configured")
	}
	return DB, nil
}

// ---- create_investigation ----

type createInvestigationArgs struct {
	Title           string   `json:"title"`
	Description     string   `json:"description"`
	Severity        string   `json:"severity"`
	RelatedServices []string `json:"related_services"`
}

type createInvestigationResult struct {
	ID       string `json:"id"`
	Title    string `json:"title"`
	Status   string `json:"status"`
	Severity string `json:"severity"`
	URL      string `json:"url"`
}

func createInvestigationInfo() *schema.ToolInfo {
	return &schema.ToolInfo{
		Name: "create_investigation",
		Desc: "Open a new Investigation (like a ticket) to track a problem that needs follow-up across time or people. Use when you discover an issue that should be remembered, assigned, and resolved with a clear root cause and solution. Don't use for casual or one-off questions.",
		ParamsOneOf: schema.NewParamsOneOfByParams(map[string]*schema.ParameterInfo{
			"title": {
				Type:     schema.String,
				Desc:     "Short human-readable title of the issue, e.g. 'API gateway 5xx spike'.",
				Required: true,
			},
			"description": {
				Type:     schema.String,
				Desc:     "Context: what was observed, where, and any initial hypothesis. Markdown allowed.",
				Required: false,
			},
			"severity": {
				Type:     schema.String,
				Desc:     "One of: critical | warning | info. Defaults to info.",
				Required: false,
				Enum:     []string{"critical", "warning", "info"},
			},
			"related_services": {
				Type:     schema.Array,
				Desc:     "Optional list of affected service names (from the services registry).",
				Required: false,
				ElemInfo: &schema.ParameterInfo{Type: schema.String},
			},
		}),
	}
}

func handleCreateInvestigation(ctx context.Context, args string) (string, error) {
	var a createInvestigationArgs
	if err := json.Unmarshal([]byte(args), &a); err != nil {
		return "", fmt.Errorf("invalid args: %w", err)
	}
	if a.Title == "" {
		return "", errors.New("'title' is required")
	}
	db, err := investigationDB()
	if err != nil {
		return "", err
	}

	inv, err := core.CreateInvestigation(db, core.CreateInvestigationInput{
		Title:           a.Title,
		Description:     a.Description,
		Severity:        a.Severity,
		Source:          "ask",
		RelatedServices: a.RelatedServices,
	})
	if err != nil {
		return "", fmt.Errorf("create investigation: %w", err)
	}

	// 关联到当前对话（若 ctx 里有 convID）
	if convID := ConversationIDFromContext(ctx); convID != "" {
		if err := core.AppendInvestigationToConversation(db, convID, inv.ID); err != nil {
			// 不失败整个工具调用——关联失败不影响单已创建的事实
			// 但给 LLM 一个提示
			_ = err
		}
	}

	out := createInvestigationResult{
		ID:       inv.ID,
		Title:    inv.Title,
		Status:   inv.Status,
		Severity: inv.Severity,
		URL:      "/i/" + inv.ID,
	}
	b, _ := json.Marshal(out)
	return string(b), nil
}

// ---- add_investigation_entry ----

type addEntryArgs struct {
	InvestigationID string `json:"investigation_id"`
	Type            string `json:"type"`
	Content         string `json:"content"`
}

type addEntryResult struct {
	EntryID         string `json:"entry_id"`
	InvestigationID string `json:"investigation_id"`
}

func addInvestigationEntryInfo() *schema.ToolInfo {
	return &schema.ToolInfo{
		Name: "add_investigation_entry",
		Desc: "Append a timeline entry to an existing Investigation. Use for significant findings ('discovery'), performed actions ('action'), or side notes ('note'). Do NOT use for resolution—use resolve_investigation instead.",
		ParamsOneOf: schema.NewParamsOneOfByParams(map[string]*schema.ParameterInfo{
			"investigation_id": {
				Type:     schema.String,
				Desc:     "The Investigation ID returned by create_investigation.",
				Required: true,
			},
			"type": {
				Type:     schema.String,
				Desc:     "discovery | action | note.",
				Required: true,
				Enum:     []string{"discovery", "action", "note"},
			},
			"content": {
				Type:     schema.String,
				Desc:     "Markdown content of the entry. Be concise and factual.",
				Required: true,
			},
		}),
	}
}

func handleAddInvestigationEntry(ctx context.Context, args string) (string, error) {
	var a addEntryArgs
	if err := json.Unmarshal([]byte(args), &a); err != nil {
		return "", fmt.Errorf("invalid args: %w", err)
	}
	if a.InvestigationID == "" || a.Type == "" || a.Content == "" {
		return "", errors.New("'investigation_id', 'type', 'content' are required")
	}
	db, err := investigationDB()
	if err != nil {
		return "", err
	}

	entry, err := core.CreateEntry(db, a.InvestigationID, a.Type, a.Content, "ai")
	if err != nil {
		return "", fmt.Errorf("add entry: %w", err)
	}
	b, _ := json.Marshal(addEntryResult{
		EntryID:         entry.ID,
		InvestigationID: entry.InvestigationID,
	})
	return string(b), nil
}

// ---- resolve_investigation ----

type resolveArgs struct {
	InvestigationID string `json:"investigation_id"`
	RootCause       string `json:"root_cause"`
	Solution        string `json:"solution"`
}

type resolveResult struct {
	ID     string `json:"id"`
	Status string `json:"status"`
}

func resolveInvestigationInfo() *schema.ToolInfo {
	return &schema.ToolInfo{
		Name: "resolve_investigation",
		Desc: "Close an Investigation with a clear root cause and solution. Adds a 'resolution' timeline entry automatically. Call this after you've verified the fix or fully understood the issue.",
		ParamsOneOf: schema.NewParamsOneOfByParams(map[string]*schema.ParameterInfo{
			"investigation_id": {
				Type:     schema.String,
				Desc:     "The Investigation ID to close.",
				Required: true,
			},
			"root_cause": {
				Type:     schema.String,
				Desc:     "The diagnosed root cause, in 1-3 sentences. Be specific.",
				Required: true,
			},
			"solution": {
				Type:     schema.String,
				Desc:     "The applied or recommended fix, including concrete commands or manifest changes.",
				Required: true,
			},
		}),
	}
}

func handleResolveInvestigation(ctx context.Context, args string) (string, error) {
	var a resolveArgs
	if err := json.Unmarshal([]byte(args), &a); err != nil {
		return "", fmt.Errorf("invalid args: %w", err)
	}
	if a.InvestigationID == "" || a.RootCause == "" || a.Solution == "" {
		return "", errors.New("'investigation_id', 'root_cause', 'solution' are required")
	}
	db, err := investigationDB()
	if err != nil {
		return "", err
	}

	inv, err := core.ResolveInvestigation(db, a.InvestigationID, a.RootCause, a.Solution, "ai")
	if err != nil {
		return "", fmt.Errorf("resolve: %w", err)
	}
	b, _ := json.Marshal(resolveResult{ID: inv.ID, Status: inv.Status})
	return string(b), nil
}
