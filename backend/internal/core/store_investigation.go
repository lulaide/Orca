package core

import (
	"encoding/json"
	"errors"
	"time"

	"github.com/google/uuid"
	"gorm.io/datatypes"
	"gorm.io/gorm"
)

// ErrInvestigationArchived 在对已归档 investigation 执行写操作时返回。
var ErrInvestigationArchived = errors.New("investigation is archived; unarchive it first")

// StatusOpen / StatusInvestigating / StatusResolved / StatusStale 是 Investigation.Status 的合法值。
const (
	StatusOpen          = "open"
	StatusInvestigating = "investigating"
	StatusResolved      = "resolved"
	StatusStale         = "stale"
)

// 合法的 severity / source / entry.type 集合（只做防御性校验，便于排错）。
var (
	validSeverities  = map[string]struct{}{"critical": {}, "warning": {}, "info": {}}
	validStatuses    = map[string]struct{}{StatusOpen: {}, StatusInvestigating: {}, StatusResolved: {}, StatusStale: {}}
	validEntryTypes  = map[string]struct{}{"discovery": {}, "action": {}, "resolution": {}, "note": {}}
	manualEntryTypes = map[string]struct{}{"discovery": {}, "action": {}, "note": {}} // resolution 只由 resolve 工具写
)

// CreateInvestigationInput 建单入参。severity 为空时默认 info；relatedServices 可空。
type CreateInvestigationInput struct {
	Title           string
	Description     string
	Severity        string
	Source          string
	EventID         *string
	RelatedServices []string
}

// CreateInvestigation 新建一个 Investigation。
// status 固定 open；title 必填，severity 默认 info。
func CreateInvestigation(db *gorm.DB, in CreateInvestigationInput) (*Investigation, error) {
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
	source := in.Source
	if source == "" {
		source = "manual"
	}

	rs := datatypes.JSON([]byte("[]"))
	if len(in.RelatedServices) > 0 {
		b, err := json.Marshal(in.RelatedServices)
		if err != nil {
			return nil, err
		}
		rs = datatypes.JSON(b)
	}

	inv := &Investigation{
		ID:              uuid.NewString(),
		Title:           in.Title,
		Description:     in.Description,
		Status:          StatusOpen,
		Severity:        sev,
		Source:          source,
		EventID:         in.EventID,
		RelatedServices: rs,
	}
	if err := db.Create(inv).Error; err != nil {
		return nil, err
	}
	return inv, nil
}

// GetInvestigation 按 ID 查询（不过滤 archived_at，由调用方决定）。
func GetInvestigation(db *gorm.DB, id string) (*Investigation, error) {
	var inv Investigation
	if err := db.First(&inv, "id = ?", id).Error; err != nil {
		return nil, err
	}
	return &inv, nil
}

// InvestigationView 是列表页的快捷视图。
type InvestigationView string

const (
	ViewActive   InvestigationView = "active"
	ViewResolved InvestigationView = "resolved"
	ViewArchived InvestigationView = "archived"
	ViewAll      InvestigationView = "all"
)

// ListInvestigationsOpts 控制列表查询。
// View 与 Statuses 二选一（View 优先）；ConversationID 通过 join 过滤。
type ListInvestigationsOpts struct {
	View           InvestigationView
	Statuses       []string
	ConversationID string
	Limit          int
}

// ListInvestigations 列表查询，按 updated_at 降序。
func ListInvestigations(db *gorm.DB, opts ListInvestigationsOpts) ([]Investigation, error) {
	q := db.Model(&Investigation{})

	switch opts.View {
	case ViewActive:
		q = q.Where("status IN ?", []string{StatusOpen, StatusInvestigating}).
			Where("archived_at IS NULL")
	case ViewResolved:
		q = q.Where("status = ?", StatusResolved).Where("archived_at IS NULL")
	case ViewArchived:
		q = q.Where("archived_at IS NOT NULL")
	case ViewAll:
		// 不加过滤
	default:
		// View 未指定：按 Statuses 过滤（若提供），且默认过滤已归档
		if len(opts.Statuses) > 0 {
			q = q.Where("status IN ?", opts.Statuses)
		}
		q = q.Where("archived_at IS NULL")
	}

	if opts.ConversationID != "" {
		q = q.Joins("JOIN conversation_investigations ci ON ci.investigation_id = investigations.id").
			Where("ci.conversation_id = ?", opts.ConversationID)
	}

	q = q.Order("investigations.updated_at DESC")
	if opts.Limit > 0 {
		q = q.Limit(opts.Limit)
	}

	var out []Investigation
	if err := q.Find(&out).Error; err != nil {
		return nil, err
	}
	return out, nil
}

// UpdateInvestigationPatch 定义允许 PATCH 的字段。指针区分"未传"与"清空"。
// Status 切到 resolved 时，调用方应同时传 RootCause / Solution；此处不强制。
type UpdateInvestigationPatch struct {
	Title       *string
	Description *string
	Status      *string
	Severity    *string
	RootCause   *string
	Solution    *string
}

// UpdateInvestigation 更新允许的字段。拒绝对已归档单操作。
// Status 变 resolved 时自动填 ResolvedAt；从 resolved 改走时不清空（保留首次解决的时间）。
func UpdateInvestigation(db *gorm.DB, id string, patch UpdateInvestigationPatch) (*Investigation, error) {
	inv, err := GetInvestigation(db, id)
	if err != nil {
		return nil, err
	}
	if inv.ArchivedAt != nil {
		return nil, ErrInvestigationArchived
	}

	updates := map[string]any{}
	if patch.Title != nil {
		updates["title"] = *patch.Title
	}
	if patch.Description != nil {
		updates["description"] = *patch.Description
	}
	if patch.Status != nil {
		if _, ok := validStatuses[*patch.Status]; !ok {
			return nil, errors.New("invalid status: " + *patch.Status)
		}
		updates["status"] = *patch.Status
		if *patch.Status == StatusResolved && inv.ResolvedAt == nil {
			now := time.Now()
			updates["resolved_at"] = now
		}
	}
	if patch.Severity != nil {
		if _, ok := validSeverities[*patch.Severity]; !ok {
			return nil, errors.New("invalid severity: " + *patch.Severity)
		}
		updates["severity"] = *patch.Severity
	}
	if patch.RootCause != nil {
		updates["root_cause"] = *patch.RootCause
	}
	if patch.Solution != nil {
		updates["solution"] = *patch.Solution
	}
	if len(updates) == 0 {
		return inv, nil
	}

	if err := db.Model(&Investigation{}).Where("id = ?", id).Updates(updates).Error; err != nil {
		return nil, err
	}
	return GetInvestigation(db, id)
}

// ArchiveInvestigation 归档单子。幂等：已归档的不改时间。
func ArchiveInvestigation(db *gorm.DB, id string) error {
	res := db.Model(&Investigation{}).
		Where("id = ? AND archived_at IS NULL", id).
		Update("archived_at", time.Now())
	return res.Error
}

// UnarchiveInvestigation 取消归档。
func UnarchiveInvestigation(db *gorm.DB, id string) error {
	return db.Model(&Investigation{}).
		Where("id = ?", id).
		Update("archived_at", nil).Error
}

// AppendInvestigationToConversation 关联 Conversation 和 Investigation。
// 幂等；同时 Touch 对话以更新活动时间。
func AppendInvestigationToConversation(db *gorm.DB, convID, invID string) error {
	return db.Transaction(func(tx *gorm.DB) error {
		link := ConversationInvestigation{
			ConversationID:  convID,
			InvestigationID: invID,
			CreatedAt:       time.Now(),
		}
		// ON CONFLICT DO NOTHING 等价：GORM 的 clause 在不同 driver 行为不同，用 FirstOrCreate 稳妥
		if err := tx.Where("conversation_id = ? AND investigation_id = ?", convID, invID).
			FirstOrCreate(&link).Error; err != nil {
			return err
		}
		return tx.Model(&Conversation{}).Where("id = ?", convID).
			Update("updated_at", time.Now()).Error
	})
}

// ListInvestigationsByConversation 返回与某对话关联的所有 investigation（含已归档，按 updated_at DESC）。
func ListInvestigationsByConversation(db *gorm.DB, convID string) ([]Investigation, error) {
	return ListInvestigations(db, ListInvestigationsOpts{
		View:           ViewAll,
		ConversationID: convID,
	})
}

// CreateEntry 追加一条 timeline 条目。拒绝对已归档单追加。
// manual 调用（author != "ai"）不允许 type=resolution。
func CreateEntry(db *gorm.DB, invID, entryType, content, author string) (*InvestigationEntry, error) {
	if content == "" {
		return nil, errors.New("content is required")
	}
	if _, ok := validEntryTypes[entryType]; !ok {
		return nil, errors.New("invalid entry type: " + entryType)
	}
	if author != "ai" {
		if _, ok := manualEntryTypes[entryType]; !ok {
			return nil, errors.New("type=resolution is reserved; use resolve_investigation instead")
		}
	}

	inv, err := GetInvestigation(db, invID)
	if err != nil {
		return nil, err
	}
	if inv.ArchivedAt != nil {
		return nil, ErrInvestigationArchived
	}

	entry := &InvestigationEntry{
		ID:              uuid.NewString(),
		InvestigationID: invID,
		Type:            entryType,
		Content:         content,
		Author:          author,
		CreatedAt:       time.Now(),
	}
	if err := db.Create(entry).Error; err != nil {
		return nil, err
	}
	// Touch investigation updated_at
	_ = db.Model(&Investigation{}).Where("id = ?", invID).Update("updated_at", time.Now()).Error
	return entry, nil
}

// ListEntries 按时间升序返回所有 entries（含归档单的）。
func ListEntries(db *gorm.DB, invID string) ([]InvestigationEntry, error) {
	var out []InvestigationEntry
	if err := db.Where("investigation_id = ?", invID).
		Order("created_at ASC").Find(&out).Error; err != nil {
		return nil, err
	}
	return out, nil
}

// ResolveInvestigation 专门用于 resolve 工具：
// 把 status 置 resolved、写 root_cause / solution / resolved_at，并追加一条 type=resolution 的 entry。
// 全程事务化。
func ResolveInvestigation(db *gorm.DB, id, rootCause, solution, author string) (*Investigation, error) {
	var inv *Investigation
	err := db.Transaction(func(tx *gorm.DB) error {
		cur, err := GetInvestigation(tx, id)
		if err != nil {
			return err
		}
		if cur.ArchivedAt != nil {
			return ErrInvestigationArchived
		}
		now := time.Now()
		updates := map[string]any{
			"status":      StatusResolved,
			"root_cause":  rootCause,
			"solution":    solution,
			"resolved_at": now,
		}
		if err := tx.Model(&Investigation{}).Where("id = ?", id).Updates(updates).Error; err != nil {
			return err
		}
		// resolution entry
		entry := &InvestigationEntry{
			ID:              uuid.NewString(),
			InvestigationID: id,
			Type:            "resolution",
			Content:         "Root cause: " + rootCause + "\n\nSolution: " + solution,
			Author:          author,
			CreatedAt:       now,
		}
		if err := tx.Create(entry).Error; err != nil {
			return err
		}
		// 回读
		fresh, err := GetInvestigation(tx, id)
		if err != nil {
			return err
		}
		inv = fresh
		return nil
	})
	if err != nil {
		return nil, err
	}
	return inv, nil
}
