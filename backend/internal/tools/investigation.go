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
var DB *gorm.DB

// NotifyMgr 全局通知管理器，由 main.go 启动时赋值。可为 nil。
var NotifyMgr interface {
	NotifyInvestigationCreated(inv *core.Investigation)
	NotifyInvestigationResolved(inv *core.Investigation)
}

// RegisterInvestigationTools 注册 Investigation 相关的 LLM 工具。
// 不含归档/删除——归档由人工决定，避免 LLM 幻觉误操作。
func RegisterInvestigationTools(reg *Registry) {
	reg.Register(listInvestigationsInfo(), handleListInvestigations)
	reg.Register(getInvestigationInfo(), handleGetInvestigation)
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

// ---- list_investigations ----

type listInvestigationsArgs struct {
	View     string `json:"view"`
	Severity string `json:"severity"`
	Limit    int    `json:"limit"`
}

type investigationBrief struct {
	ID        string `json:"id"`
	Title     string `json:"title"`
	Status    string `json:"status"`
	Severity  string `json:"severity"`
	UpdatedAt string `json:"updated_at"`
}

func listInvestigationsInfo() *schema.ToolInfo {
	return &schema.ToolInfo{
		Name: "list_investigations",
		Desc: "List existing Investigations. Use to show the user what's being tracked, or to find an Investigation by keyword before drilling in with get_investigation. Returns brief records ordered by most recently updated.",
		ParamsOneOf: schema.NewParamsOneOfByParams(map[string]*schema.ParameterInfo{
			"view": {
				Type:     schema.String,
				Desc:     "Filter scope: active (open+investigating, default), resolved, archived, all.",
				Required: false,
				Enum:     []string{"active", "resolved", "archived", "all"},
			},
			"severity": {
				Type:     schema.String,
				Desc:     "Optional severity filter: critical | warning | info.",
				Required: false,
				Enum:     []string{"critical", "warning", "info"},
			},
			"limit": {
				Type:     schema.Integer,
				Desc:     "Max rows to return (default 20, max 100).",
				Required: false,
			},
		}),
	}
}

func handleListInvestigations(ctx context.Context, args string) (string, error) {
	var a listInvestigationsArgs
	if args != "" && args != "{}" {
		if err := json.Unmarshal([]byte(args), &a); err != nil {
			return "", fmt.Errorf("invalid args: %w", err)
		}
	}
	db, err := investigationDB()
	if err != nil {
		return "", err
	}

	view := core.ViewActive
	switch a.View {
	case "resolved":
		view = core.ViewResolved
	case "archived":
		view = core.ViewArchived
	case "all":
		view = core.ViewAll
	}

	limit := a.Limit
	if limit <= 0 {
		limit = 20
	}
	if limit > 100 {
		limit = 100
	}

	rows, err := core.ListInvestigations(db, core.ListInvestigationsOpts{
		View:  view,
		Limit: limit,
	})
	if err != nil {
		return "", fmt.Errorf("list investigations: %w", err)
	}

	out := make([]investigationBrief, 0, len(rows))
	for _, r := range rows {
		if a.Severity != "" && r.Severity != a.Severity {
			continue
		}
		out = append(out, investigationBrief{
			ID:        r.ID,
			Title:     r.Title,
			Status:    r.Status,
			Severity:  r.Severity,
			UpdatedAt: r.UpdatedAt.Format("2006-01-02T15:04:05Z07:00"),
		})
	}
	b, _ := json.Marshal(out)
	return string(b), nil
}

// ---- get_investigation ----

type getInvestigationArgs struct {
	ID string `json:"id"`
}

type investigationDetail struct {
	ID              string   `json:"id"`
	Title           string   `json:"title"`
	Description     string   `json:"description,omitempty"`
	Status          string   `json:"status"`
	Severity        string   `json:"severity"`
	Source          string   `json:"source,omitempty"`
	RelatedServices []string `json:"related_services,omitempty"`
	RootCause       string   `json:"root_cause,omitempty"`
	Solution        string   `json:"solution,omitempty"`
	CreatedAt       string   `json:"created_at"`
	UpdatedAt       string   `json:"updated_at"`
	ResolvedAt      string   `json:"resolved_at,omitempty"`
	Archived        bool     `json:"archived,omitempty"`
	Entries         []entryBrief `json:"entries"`
	EntriesTrimmed  bool     `json:"entries_trimmed,omitempty"`
}

type entryBrief struct {
	Type      string `json:"type"`
	Author    string `json:"author"`
	Content   string `json:"content"`
	CreatedAt string `json:"created_at"`
}

func getInvestigationInfo() *schema.ToolInfo {
	return &schema.ToolInfo{
		Name: "get_investigation",
		Desc: "Fetch full details of one Investigation by ID, including the latest timeline entries (discoveries/actions/notes/resolution). Use this when the user asks about a specific Investigation, or after list_investigations narrowed down the target.",
		ParamsOneOf: schema.NewParamsOneOfByParams(map[string]*schema.ParameterInfo{
			"id": {
				Type:     schema.String,
				Desc:     "The Investigation ID (uuid).",
				Required: true,
			},
		}),
	}
}

func handleGetInvestigation(ctx context.Context, args string) (string, error) {
	var a getInvestigationArgs
	if err := json.Unmarshal([]byte(args), &a); err != nil {
		return "", fmt.Errorf("invalid args: %w", err)
	}
	if a.ID == "" {
		return "", errors.New("'id' is required")
	}
	db, err := investigationDB()
	if err != nil {
		return "", err
	}

	inv, err := core.GetInvestigation(db, a.ID)
	if err != nil {
		return "", fmt.Errorf("get investigation: %w", err)
	}
	entries, err := core.ListEntries(db, a.ID)
	if err != nil {
		return "", fmt.Errorf("list entries: %w", err)
	}

	// 取最近 20 条（entries 是升序，按尾部截断）
	const maxEntries = 20
	trimmed := false
	if len(entries) > maxEntries {
		entries = entries[len(entries)-maxEntries:]
		trimmed = true
	}

	briefs := make([]entryBrief, 0, len(entries))
	for _, e := range entries {
		briefs = append(briefs, entryBrief{
			Type:      e.Type,
			Author:    e.Author,
			Content:   e.Content,
			CreatedAt: e.CreatedAt.Format("2006-01-02T15:04:05Z07:00"),
		})
	}

	var related []string
	if len(inv.RelatedServices) > 0 {
		_ = json.Unmarshal(inv.RelatedServices, &related)
	}

	detail := investigationDetail{
		ID:              inv.ID,
		Title:           inv.Title,
		Description:     inv.Description,
		Status:          inv.Status,
		Severity:        inv.Severity,
		Source:          inv.Source,
		RelatedServices: related,
		CreatedAt:       inv.CreatedAt.Format("2006-01-02T15:04:05Z07:00"),
		UpdatedAt:       inv.UpdatedAt.Format("2006-01-02T15:04:05Z07:00"),
		Entries:         briefs,
		EntriesTrimmed:  trimmed,
	}
	if inv.RootCause != nil {
		detail.RootCause = *inv.RootCause
	}
	if inv.Solution != nil {
		detail.Solution = *inv.Solution
	}
	if inv.ResolvedAt != nil {
		detail.ResolvedAt = inv.ResolvedAt.Format("2006-01-02T15:04:05Z07:00")
	}
	if inv.ArchivedAt != nil {
		detail.Archived = true
	}

	b, _ := json.Marshal(detail)
	return string(b), nil
}

// ---- create_investigation ----

type createInvestigationArgs struct {
	Title           string   `json:"title"`
	Description     string   `json:"description"`
	Severity        string   `json:"severity"`
	RelatedServices []string `json:"related_services"`
	EventID         string   `json:"event_id"`
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
		Desc: "Open a new Investigation to track a problem that needs follow-up across time or people. Use when you discover an issue that should be remembered, assigned, and resolved with a clear root cause and solution. Don't use for casual or one-off questions.",
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
			"event_id": {
				Type:     schema.String,
				Desc:     "Optional: the Event ID that triggered this investigation. In UNATTENDED (event-driven) mode this is auto-filled from context — you usually don't need to pass it.",
				Required: false,
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

	// Source / EventID 的来源优先级：显式参数 > ctx（自动值守） > "ask"（Web 对话默认）。
	// 当关联到 Event 时，source 取原始 event.source（例如 "uptime-kuma"），
	// 让 Investigation 列表能直接按告警源过滤。
	source := "ask"
	var eventID *string
	if a.EventID != "" {
		eid := a.EventID
		eventID = &eid
	} else if ctxEID := EventIDFromContext(ctx); ctxEID != "" {
		eid := ctxEID
		eventID = &eid
	}
	if eventID != nil {
		if ev, err := core.GetEvent(db, *eventID); err == nil {
			source = ev.Source
		} else {
			// 找不到事件：保留 event_id 指针，但 source 落到通用的 "event"
			source = "event"
		}
	}

	inv, err := core.CreateInvestigation(db, core.CreateInvestigationInput{
		Title:           a.Title,
		Description:     a.Description,
		Severity:        a.Severity,
		Source:          source,
		EventID:         eventID,
		RelatedServices: a.RelatedServices,
	})
	if err != nil {
		return "", fmt.Errorf("create investigation: %w", err)
	}

	// 通知
	if NotifyMgr != nil {
		NotifyMgr.NotifyInvestigationCreated(inv)
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

	// 通知
	if NotifyMgr != nil {
		NotifyMgr.NotifyInvestigationResolved(inv)
	}

	b, _ := json.Marshal(resolveResult{ID: inv.ID, Status: inv.Status})
	return string(b), nil
}
