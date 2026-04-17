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
		ID:    uuid.NewString(),
		Title: title,
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

// ListConversations 返回所有对话，按 updated_at 降序（最新活动的在前）。
// 侧边栏列表用，不返回消息内容。
func ListConversations(db *gorm.DB) ([]Conversation, error) {
	var convs []Conversation
	if err := db.Order("updated_at DESC").Find(&convs).Error; err != nil {
		return nil, err
	}
	return convs, nil
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
