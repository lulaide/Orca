package core

import (
	"encoding/json"
	"time"

	"github.com/cloudwego/eino/schema"
	"github.com/google/uuid"
	"gorm.io/datatypes"
	"gorm.io/gorm"
)

// CreateConversation 新建一个对话，title 可空（稍后由 LLM 总结填充）。
func CreateConversation(db *gorm.DB, title string) (*Conversation, error) {
	c := &Conversation{
		ID:               uuid.NewString(),
		Title:            title,
		InvestigationIDs: datatypes.JSON([]byte("[]")),
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

// SaveEinoMessage 把一个 eino schema.Message 拆成 DB 行存入 messages 表。
// 返回保存后的行（含 ID / CreatedAt）。
func SaveEinoMessage(db *gorm.DB, convID string, m *schema.Message) (*Message, error) {
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
	if err := db.Create(row).Error; err != nil {
		return nil, err
	}
	return row, nil
}

// ToEinoMessages 把 DB 行反序列化成 eino 的 []*schema.Message，用于组 History 喂给 LLM。
func ToEinoMessages(rows []Message) ([]*schema.Message, error) {
	out := make([]*schema.Message, 0, len(rows))
	for _, r := range rows {
		m := &schema.Message{
			Role:       schema.RoleType(r.Role),
			Content:    r.Content,
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
