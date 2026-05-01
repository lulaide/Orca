package core

import (
	"encoding/json"
	"strings"
	"time"

	"github.com/cloudwego/eino/schema"
	"github.com/google/uuid"
	"gorm.io/datatypes"
	"gorm.io/gorm"
)

// CreateConversation 新建一个对话，title 可空（稍后由 LLM 总结填充）。
// convType: "chat"（用户对话）| "event"（事件 Agent）
// userID: chat 类型填当前用户 ID，event 类型传空字符串。
func CreateConversation(db *gorm.DB, title, convType, userID string) (*Conversation, error) {
	if convType == "" {
		convType = "chat"
	}
	c := &Conversation{
		ID:     uuid.NewString(),
		Title:  title,
		Type:   convType,
		UserID: userID,
	}
	if err := db.Create(c).Error; err != nil {
		return nil, err
	}
	return c, nil
}

// GetConversation 按 ID 查询对话，不存在返回错误。
func GetConversation(db *gorm.DB, id string) (*Conversation, error) {
	var c Conversation
	if err := db.First(&c, "id = ?", id).Error; err != nil {
		return nil, err
	}
	return &c, nil
}

// ListMessages 返回对话下的所有消息，按 created_at 升序。
func ListMessages(db *gorm.DB, convID string) ([]Message, error) {
	var msgs []Message
	if err := db.Where("conversation_id = ?", convID).
		Order("created_at ASC").
		Find(&msgs).Error; err != nil {
		return nil, err
	}
	return msgs, nil
}

// ListConversations 返回指定用户的 chat 类型对话，按 updated_at 降序。
func ListConversations(db *gorm.DB, userID string) ([]Conversation, error) {
	var convs []Conversation
	q := db.Where("type = ? AND user_id = ?", "chat", userID).Order("updated_at DESC")
	if err := q.Find(&convs).Error; err != nil {
		return nil, err
	}
	return convs, nil
}

// ForkConversation 复制源对话的所有消息到一个新的 chat 对话。
func ForkConversation(db *gorm.DB, sourceID, userID string) (*Conversation, error) {
	// 读源对话消息
	msgs, err := ListMessages(db, sourceID)
	if err != nil {
		return nil, err
	}

	// 读源对话标题
	src, err := GetConversation(db, sourceID)
	if err != nil {
		return nil, err
	}

	// 创建新对话
	title := src.Title
	if title != "" {
		title = title + "（续）"
	}
	conv, err := CreateConversation(db, title, "chat", userID)
	if err != nil {
		return nil, err
	}

	// 复制消息（新 UUID）。只跳过 system 消息（Engine.Run 会自己加），
	// 其余全部保留，包括 tool_calls 和 tool results，保持完整上下文。
	// 保留原始消息时间，确保 ORDER BY created_at 保持原始顺序。
	for _, m := range msgs {
		if m.Role == "system" {
			continue
		}
		clone := Message{
			ID:             uuid.NewString(),
			ConversationID: conv.ID,
			Role:           m.Role,
			Content:        m.Content,
			ToolCalls:      m.ToolCalls,
			ToolCallID:     m.ToolCallID,
			ToolName:       m.ToolName,
			Metadata:       m.Metadata,
			CreatedAt:      m.CreatedAt,
		}
		db.Create(&clone)
	}

	return conv, nil
}

// SetConversationTitle 设置对话标题。title 会被截断到 80 字符内，避免过长。
func SetConversationTitle(db *gorm.DB, id, title string) error {
	if len(title) > 80 {
		// 按 rune 截断避免切断 UTF-8 字符
		runes := []rune(title)
		if len(runes) > 60 {
			title = string(runes[:60]) + "…"
		}
	}
	return db.Model(&Conversation{}).Where("id = ?", id).Update("title", title).Error
}

// TouchConversation 更新 updated_at 时间戳，让该会话在侧边栏排到最前。
func TouchConversation(db *gorm.DB, id string) error {
	return db.Model(&Conversation{}).Where("id = ?", id).Update("updated_at", time.Now()).Error
}

// DeleteConversation 删除对话及其全部消息（不删关联的 Investigation，它们是独立资源）。
func DeleteConversation(db *gorm.DB, id string) error {
	return db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("conversation_id = ?", id).Delete(&Message{}).Error; err != nil {
			return err
		}
		return tx.Delete(&Conversation{}, "id = ?", id).Error
	})
}

// SaveEinoMessage 把一个 eino schema.Message 拆成 DB 行存入 messages 表。
// 对 assistant 消息自动提取 token usage 存入 metadata。
func SaveEinoMessage(db *gorm.DB, convID string, m *schema.Message) (*Message, error) {
	var meta map[string]any
	// 自动提取 token usage
	if m.Role == schema.Assistant && m.ResponseMeta != nil && m.ResponseMeta.Usage != nil {
		u := m.ResponseMeta.Usage
		meta = map[string]any{
			"prompt_tokens":     u.PromptTokens,
			"completion_tokens": u.CompletionTokens,
			"total_tokens":      u.TotalTokens,
			"cached_tokens":     u.PromptTokenDetails.CachedTokens,
		}
	}
	return SaveEinoMessageWithMetadata(db, convID, m, meta)
}

// SaveEinoMessageWithMetadata 与 SaveEinoMessage 同，但允许附加一个 metadata map，
// 以 JSONB 存到 messages.metadata。当前使用场景:
//
//	{ "referenced_investigations": [{id,title,severity,status}, ...] }
//
// 传 nil 或空 map 时不写 metadata。
func SaveEinoMessageWithMetadata(
	db *gorm.DB,
	convID string,
	m *schema.Message,
	metadata map[string]any,
) (*Message, error) {
	row := &Message{
		ID:             uuid.NewString(),
		ConversationID: convID,
		Role:           string(m.Role),
		Content:        m.Content,
		ToolCallID:     m.ToolCallID,
		ToolName:       m.ToolName,
		CreatedAt:      time.Now(),
	}
	if len(m.ToolCalls) > 0 {
		b, err := json.Marshal(m.ToolCalls)
		if err != nil {
			return nil, err
		}
		row.ToolCalls = datatypes.JSON(b)
	}
	if len(metadata) > 0 {
		b, err := json.Marshal(metadata)
		if err != nil {
			return nil, err
		}
		row.Metadata = datatypes.JSON(b)
	}
	if err := db.Create(row).Error; err != nil {
		return nil, err
	}
	return row, nil
}

// ToEinoMessages 把 DB 行反序列化成 eino 的 []*schema.Message，用于组 History 喂给 LLM。
// 对 role=user 的消息，若 metadata.referenced_investigations 非空，会把引用摘要拼到 Content 前,
// 让 LLM 看到"这条消息引用了哪些 investigation"。前端依旧读原始 Content,不受影响。
func ToEinoMessages(rows []Message) ([]*schema.Message, error) {
	out := make([]*schema.Message, 0, len(rows))
	for _, r := range rows {
		content := r.Content
		if r.Role == "user" && len(r.Metadata) > 0 {
			if prefix := buildReferencedInvestigationsPrefix(r.Metadata); prefix != "" {
				content = prefix + content
			}
		}
		m := &schema.Message{
			Role:       schema.RoleType(r.Role),
			Content:    content,
			ToolCallID: r.ToolCallID,
			ToolName:   r.ToolName,
		}
		if len(r.ToolCalls) > 0 {
			var tcs []schema.ToolCall
			if err := json.Unmarshal(r.ToolCalls, &tcs); err != nil {
				return nil, err
			}
			m.ToolCalls = tcs
		}
		out = append(out, m)
	}
	return out, nil
}

// BuildReferencedInvestigationsPrefix 给定结构化引用切片，返回注入到 user content 前的文本块。
// 供 handler 在处理"当前请求的引用"时直接调用（metadata 还未落库也能预先注入）。
// 切片为空返回空串。
func BuildReferencedInvestigationsPrefix(refs []ReferencedInvestigationRef) string {
	if len(refs) == 0 {
		return ""
	}
	var b strings.Builder
	b.WriteString("[用户引用的调查]\n")
	for _, r := range refs {
		b.WriteString("- id=")
		b.WriteString(r.ID)
		b.WriteString(" | title=")
		b.WriteString(r.Title)
		if r.Severity != "" {
			b.WriteString(" | severity=")
			b.WriteString(r.Severity)
		}
		if r.Status != "" {
			b.WriteString(" | status=")
			b.WriteString(r.Status)
		}
		b.WriteString("\n")
	}
	b.WriteString("若需详情或时间线,调用 get_investigation。\n\n")
	return b.String()
}

// ReferencedInvestigationRef 是 BuildReferencedInvestigationsPrefix 接受的精简引用形状。
// 与 API 层 referencedInvestigation 字段一致,但避免 core 依赖 api 包。
type ReferencedInvestigationRef struct {
	ID       string `json:"id"`
	Title    string `json:"title"`
	Severity string `json:"severity"`
	Status   string `json:"status"`
}

// buildReferencedInvestigationsPrefix 从 JSONB metadata 中解析引用并生成 prefix。
func buildReferencedInvestigationsPrefix(meta []byte) string {
	var parsed struct {
		ReferencedInvestigations []ReferencedInvestigationRef `json:"referenced_investigations"`
	}
	if err := json.Unmarshal(meta, &parsed); err != nil {
		return ""
	}
	return BuildReferencedInvestigationsPrefix(parsed.ReferencedInvestigations)
}
