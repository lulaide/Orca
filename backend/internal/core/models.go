package core

import (
	"time"

	"gorm.io/datatypes"
)

// Conversation 是一次聊天的容器。
// 用户在 Web/IM 发起的每段对话对应一个 Conversation。
// 与 Investigation 的多对多关联通过 ConversationInvestigation 表维护。
type Conversation struct {
	ID        string    `gorm:"primaryKey" json:"id"`
	Title     string    `json:"title"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// Message 是 Conversation 中的一条消息。
//
// 按 LLM API 格式存储全部消息（含工具调用），字段对齐 eino schema.Message 的核心子集：
//   - Role        = "user" | "assistant" | "tool" | "system"
//   - Content     用户输入或模型输出的文本（assistant 纯 tool_calls 时可空）
//   - ToolCalls   仅 assistant 有，JSONB 存 []schema.ToolCall
//   - ToolCallID  仅 role=tool 有，指回 assistant.tool_calls[i].id
//   - ToolName    仅 role=tool 有，工具名称（便于前端展示）
//   - Metadata    消息级扩展 JSON。当前用法:
//                   { "referenced_investigations": [{id,title,severity,status}, ...] }
//                 Agent 或前端可以往这里加结构化标注，而不用污染 Content 文本。
type Message struct {
	ID             string         `gorm:"primaryKey" json:"id"`
	ConversationID string         `gorm:"index" json:"conversation_id"`
	Role           string         `json:"role"`
	Content        string         `gorm:"type:text" json:"content"`
	ToolCalls      datatypes.JSON `gorm:"type:jsonb" json:"tool_calls,omitempty"`
	ToolCallID     string         `gorm:"index" json:"tool_call_id,omitempty"`
	ToolName       string         `json:"tool_name,omitempty"`
	Metadata       datatypes.JSON `gorm:"type:jsonb" json:"metadata,omitempty"`
	CreatedAt      time.Time      `json:"created_at"`
}

// Investigation 是一个独立的问题追踪资源,代表一次"调查"。
// 由事件自动生成，或 AI/用户在对话中主动创建。
//
// ArchivedAt 为非空表示已归档——从"进行中/已解决"默认视图隐藏，
// 但详情与历史引用仍可查。与 Status 正交：Status 描述问题本身，
// ArchivedAt 描述调查的生命周期。
type Investigation struct {
	ID              string         `gorm:"primaryKey" json:"id"`
	Title           string         `json:"title"`
	Description     string         `gorm:"type:text" json:"description"`
	Status          string         `gorm:"default:open" json:"status"`   // open | investigating | resolved | stale
	Severity        string         `gorm:"default:info" json:"severity"` // critical | warning | info
	Source          string         `json:"source"`                       // uptime-kuma | patrol | ask | manual
	EventID         *string        `json:"event_id,omitempty"`
	RelatedServices datatypes.JSON `gorm:"type:jsonb" json:"related_services"`
	RootCause       *string        `gorm:"type:text" json:"root_cause,omitempty"`
	Solution        *string        `gorm:"type:text" json:"solution,omitempty"`
	CreatedAt       time.Time      `json:"created_at"`
	UpdatedAt       time.Time      `json:"updated_at"`
	ResolvedAt      *time.Time     `json:"resolved_at,omitempty"`
	ArchivedAt      *time.Time     `gorm:"index" json:"archived_at,omitempty"`
}

// InvestigationEntry 是 Investigation 时间线上的一个条目。
// 类似 Statuspage 的事件更新流，记录每一步发现/操作/结论。
type InvestigationEntry struct {
	ID              string    `gorm:"primaryKey" json:"id"`
	InvestigationID string    `gorm:"index" json:"investigation_id"`
	Type            string    `json:"type"` // discovery | action | resolution | note
	Content         string    `gorm:"type:text" json:"content"`
	Author          string    `json:"author"` // "ai" | user_id
	CreatedAt       time.Time `json:"created_at"`
}

// ConversationInvestigation 是 Conversation 与 Investigation 的多对多关联表。
// AI 在 chat 中创建 Investigation 时追加一行；归档不级联，关联保留供历史引用回溯。
type ConversationInvestigation struct {
	ConversationID  string    `gorm:"primaryKey" json:"conversation_id"`
	InvestigationID string    `gorm:"primaryKey" json:"investigation_id"`
	CreatedAt       time.Time `json:"created_at"`
}

// Event 是 Orca 捕捉到的一次外部信号（来自告警源 / CI-CD / 巡检 / 用户请求）。
// 触发 Agent 的自动值守流程；Agent 探索后自己决定创建 0..N 个 Investigation。
//
// DedupKey 用于同告警源 60 秒窗口内的去重（UptimeKuma 的心跳会按秒重发）。
// ProcessedAt / AgentSummary 是 Agent Loop 跑完后回填的——即使 Agent 没建
// 任何 Investigation（瞬时抖动），也会留下审计痕迹。
type Event struct {
	ID              string         `gorm:"primaryKey" json:"id"`
	Source          string         `gorm:"index" json:"source"`                     // "uptime-kuma" | "prometheus" | ...
	Severity        string         `gorm:"default:info" json:"severity"`            // critical | warning | info
	Title           string         `json:"title"`
	Payload         datatypes.JSON `gorm:"type:jsonb" json:"payload"`
	RelatedServices datatypes.JSON `gorm:"type:jsonb" json:"related_services"`
	DedupKey        string         `gorm:"index" json:"dedup_key"`
	ProcessedAt     *time.Time     `json:"processed_at,omitempty"`
	AgentSummary    string         `gorm:"type:text" json:"agent_summary,omitempty"`
	// ConversationID 指向 Router 为这次事件创建的 Agent 对话；前端用它加载完整
	// 工具调用流。Agent 尚未运行（比如刚入库）时为空字符串。
	ConversationID string    `gorm:"index" json:"conversation_id,omitempty"`
	CreatedAt      time.Time `gorm:"index" json:"created_at"`
}

// KnowledgePage 是知识库中的一篇文档。多篇文档通过 parent_slug 组成树形结构。
// Agent 扫描集群时自动生成（概述 / namespace / 服务 / 架构关系等），
// 用户也可以手动编辑 content。
type KnowledgePage struct {
	Slug       string    `gorm:"primaryKey" json:"slug"`         // 唯一路径，如 "overview"、"ns/kube-system"、"svc/kube-system/coredns"
	Title      string    `json:"title"`
	Content    string    `gorm:"type:text" json:"content"`       // Markdown
	ParentSlug string    `gorm:"index" json:"parent_slug"`       // 父页面 slug（空表示顶级）
	SortOrder  int       `json:"sort_order"`                     // 同级排序
	UpdatedAt  time.Time `json:"updated_at"`
}

// MCPConnection 是一个外部 MCP Server 的连接配置。
// Orca 作为 MCP Client 连接到这些 Server，发现并注册它们提供的工具，
// 让 Agent 在推理时能调用外部能力（如 Cloudflare DNS、Grafana 查询等）。
type MCPConnection struct {
	ID        string `gorm:"primaryKey" json:"id"`
	Name      string `gorm:"uniqueIndex" json:"name"` // 用作工具前缀 name/tool_name
	Transport string `json:"transport"`                // "stdio" | "sse"
	// stdio 字段
	Command string         `json:"command,omitempty"`
	Args    datatypes.JSON `gorm:"type:jsonb" json:"args,omitempty"` // ["arg1","arg2"]
	Env     datatypes.JSON `gorm:"type:jsonb" json:"env,omitempty"`  // {"KEY":"val"} 传给子进程
	// sse 字段
	URL string `json:"url,omitempty"`
	// auth 字段
	AuthType  string `json:"auth_type,omitempty"`  // "none" | "bearer" | "oauth"
	AuthToken string `json:"auth_token,omitempty"` // bearer 模式的静态 token
	// OAuth 字段
	OAuthClientID     string         `json:"oauth_client_id,omitempty"`
	OAuthClientSecret string         `json:"oauth_client_secret,omitempty"`
	OAuthScopes       string         `json:"oauth_scopes,omitempty"`                // 空格分隔
	OAuthToken        datatypes.JSON `gorm:"type:jsonb" json:"oauth_token,omitempty"` // 持久化 Token JSON
	//
	Description string    `json:"description,omitempty"`
	Enabled     bool      `gorm:"default:true" json:"enabled"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

// PluginConfig 是 Trigger 插件的运行时实例配置。
// 插件"类型"由 Go 代码静态注册到 triggers.Registry；"实例配置"存本表，
// Web 面板可启用/禁用、轮换 secret_token、改 JSONB 配置。
type PluginConfig struct {
	ID          string         `gorm:"primaryKey" json:"id"`
	PluginName  string         `gorm:"uniqueIndex" json:"plugin_name"` // 对应 Plugin.Name()
	Enabled     bool           `gorm:"default:true" json:"enabled"`
	SecretToken string         `json:"secret_token,omitempty"`
	Config      datatypes.JSON `gorm:"type:jsonb" json:"config,omitempty"`
	CreatedAt   time.Time      `json:"created_at"`
	UpdatedAt   time.Time      `json:"updated_at"`
}
