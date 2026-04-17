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
type Message struct {
	ID             string         `gorm:"primaryKey" json:"id"`
	ConversationID string         `gorm:"index" json:"conversation_id"`
	Role           string         `json:"role"`
	Content        string         `gorm:"type:text" json:"content"`
	ToolCalls      datatypes.JSON `gorm:"type:jsonb" json:"tool_calls,omitempty"`
	ToolCallID     string         `gorm:"index" json:"tool_call_id,omitempty"`
	ToolName       string         `json:"tool_name,omitempty"`
	CreatedAt      time.Time      `json:"created_at"`
}

// Investigation 是一个独立的问题追踪资源（类似工单）。
// 由事件自动生成，或 AI/用户在对话中主动创建。
//
// ArchivedAt 为非空表示已归档——从"进行中/已解决"默认视图隐藏，
// 但详情与历史引用仍可查。与 Status 正交：Status 描述问题本身，
// ArchivedAt 描述工单生命周期。
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
