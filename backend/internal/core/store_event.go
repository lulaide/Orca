package core

import (
	"encoding/json"
	"errors"
	"time"

	"github.com/google/uuid"
	"gorm.io/datatypes"
	"gorm.io/gorm"
)

// CreateEventInput 建 Event 入参。Payload 可以直接丢原始 JSON bytes；
// RelatedServices 由插件从 payload 解出来的服务名列表。
type CreateEventInput struct {
	Source          string
	Severity        string
	Title           string
	Payload         []byte
	RelatedServices []string
	DedupKey        string
}

// CreateEvent 写入一条 Event 行。
func CreateEvent(db *gorm.DB, in CreateEventInput) (*Event, error) {
	if in.Source == "" {
		return nil, errors.New("source is required")
	}
	if in.Title == "" {
		return nil, errors.New("title is required")
	}
	sev := in.Severity
	if sev == "" {
		sev = "info"
	}
	if _, ok := validSeverities[sev]; !ok {
		return nil, errors.New("invalid severity: " + sev)
	}

	payload := datatypes.JSON(in.Payload)
	if len(payload) == 0 {
		payload = datatypes.JSON([]byte("{}"))
	}
	rs := datatypes.JSON([]byte("[]"))
	if len(in.RelatedServices) > 0 {
		b, err := json.Marshal(in.RelatedServices)
		if err != nil {
			return nil, err
		}
		rs = datatypes.JSON(b)
	}

	ev := &Event{
		ID:              uuid.NewString(),
		Source:          in.Source,
		Severity:        sev,
		Title:           in.Title,
		Payload:         payload,
		RelatedServices: rs,
		DedupKey:        in.DedupKey,
	}
	if err := db.Create(ev).Error; err != nil {
		return nil, err
	}
	return ev, nil
}

// GetEvent 按 ID 查。
func GetEvent(db *gorm.DB, id string) (*Event, error) {
	var ev Event
	if err := db.First(&ev, "id = ?", id).Error; err != nil {
		return nil, err
	}
	return &ev, nil
}

// ListEventsOpts 控制列表查询。
type ListEventsOpts struct {
	Source    string // 精确匹配
	Severity  string // 精确匹配
	Processed *bool  // nil=不过滤 / true=已处理 / false=待处理
	Limit     int
}

// ListEvents 按 created_at 降序列出事件。
func ListEvents(db *gorm.DB, opts ListEventsOpts) ([]Event, error) {
	q := db.Model(&Event{})
	if opts.Source != "" {
		q = q.Where("source = ?", opts.Source)
	}
	if opts.Severity != "" {
		q = q.Where("severity = ?", opts.Severity)
	}
	if opts.Processed != nil {
		if *opts.Processed {
			q = q.Where("processed_at IS NOT NULL")
		} else {
			q = q.Where("processed_at IS NULL")
		}
	}
	q = q.Order("created_at DESC")
	if opts.Limit > 0 {
		q = q.Limit(opts.Limit)
	}
	var out []Event
	if err := q.Find(&out).Error; err != nil {
		return nil, err
	}
	return out, nil
}

// MarkEventProcessed 写入 Agent Loop 跑完后的 summary + 时间戳。
// summary 可以为空（Agent 没给文本结论时）。
func MarkEventProcessed(db *gorm.DB, id, summary string) error {
	now := time.Now()
	return db.Model(&Event{}).Where("id = ?", id).Updates(map[string]any{
		"processed_at":  now,
		"agent_summary": summary,
	}).Error
}

// SetEventConversation 把 Event 关联到一个已创建的 Conversation。
// Router 会在启动 Agent Loop 之前调一次，让前端能通过 event.conversation_id
// 加载完整的 Agent 消息流。
func SetEventConversation(db *gorm.DB, eventID, convID string) error {
	return db.Model(&Event{}).Where("id = ?", eventID).
		Update("conversation_id", convID).Error
}

// FindRecentDuplicate 若 within 时间内已存在同 dedupKey 的 Event，返回它；否则返回 nil。
// 空 dedupKey 直接返回 nil（插件未给 key 就不参与去重）。
func FindRecentDuplicate(db *gorm.DB, dedupKey string, within time.Duration) (*Event, error) {
	if dedupKey == "" {
		return nil, nil
	}
	cutoff := time.Now().Add(-within)
	var ev Event
	err := db.Where("dedup_key = ? AND created_at >= ?", dedupKey, cutoff).
		Order("created_at DESC").
		First(&ev).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, err
	}
	return &ev, nil
}

// ListInvestigationsByEvent 反向查：该 Event 产生了哪些 Investigation。
func ListInvestigationsByEvent(db *gorm.DB, eventID string) ([]Investigation, error) {
	var out []Investigation
	if err := db.Where("event_id = ?", eventID).
		Order("created_at ASC").Find(&out).Error; err != nil {
		return nil, err
	}
	return out, nil
}
