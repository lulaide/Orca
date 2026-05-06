package api

import (
	"errors"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"github.com/lulaide/orca/internal/agents"
	"github.com/lulaide/orca/internal/core"
)

// ---- /api/investigations (POST 建单) ----

type createInvestigationRequest struct {
	Title           string   `json:"title" binding:"required"`
	Description     string   `json:"description"`
	Severity        string   `json:"severity"`
	Source          string   `json:"source"`
	RelatedServices []string `json:"related_services"`
	EventID         *string  `json:"event_id"`
}

func (d *Deps) handleCreateInvestigation(c *gin.Context) {
	var req createInvestigationRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	inv, err := core.CreateInvestigation(d.DB, core.CreateInvestigationInput{
		Title:           req.Title,
		Description:     req.Description,
		Severity:        req.Severity,
		Source:          req.Source,
		EventID:         req.EventID,
		RelatedServices: req.RelatedServices,
	})
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, inv)
}

// ---- /api/investigations (GET 列表) ----

func (d *Deps) handleListInvestigations(c *gin.Context) {
	view := core.InvestigationView(c.Query("view"))
	// 默认视图 active
	if view == "" {
		view = core.ViewActive
	}
	// 允许 status 参数覆盖 view：?status=open,investigating
	statuses := []string{}
	if s := c.Query("status"); s != "" {
		for _, part := range strings.Split(s, ",") {
			if p := strings.TrimSpace(part); p != "" {
				statuses = append(statuses, p)
			}
		}
		view = "" // 交给 default 分支
	}
	opts := core.ListInvestigationsOpts{
		View:           view,
		Statuses:       statuses,
		ConversationID: c.Query("conversation_id"),
	}
	list, err := core.ListInvestigations(d.DB, opts)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if list == nil {
		list = []core.Investigation{}
	}
	c.JSON(http.StatusOK, list)
}

// ---- /api/investigations/:id (GET 详情) ----

func (d *Deps) handleGetInvestigation(c *gin.Context) {
	id := c.Param("id")
	inv, err := core.GetInvestigation(d.DB, id)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "investigation not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, inv)
}

// ---- /api/investigations/:id (PATCH) ----

type updateInvestigationRequest struct {
	Title       *string `json:"title"`
	Description *string `json:"description"`
	Status      *string `json:"status"`
	Severity    *string `json:"severity"`
	RootCause   *string `json:"root_cause"`
	Solution    *string `json:"solution"`
}

func (d *Deps) handleUpdateInvestigation(c *gin.Context) {
	id := c.Param("id")
	var req updateInvestigationRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	inv, err := core.UpdateInvestigation(d.DB, id, core.UpdateInvestigationPatch{
		Title:       req.Title,
		Description: req.Description,
		Status:      req.Status,
		Severity:    req.Severity,
		RootCause:   req.RootCause,
		Solution:    req.Solution,
	})
	if err != nil {
		switch {
		case errors.Is(err, gorm.ErrRecordNotFound):
			c.JSON(http.StatusNotFound, gin.H{"error": "investigation not found"})
		case errors.Is(err, core.ErrInvestigationArchived):
			c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
		default:
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		}
		return
	}
	c.JSON(http.StatusOK, inv)
}

// ---- /api/investigations/:id/archive (POST) ----

func (d *Deps) handleArchiveInvestigation(c *gin.Context) {
	id := c.Param("id")
	if _, err := core.GetInvestigation(d.DB, id); err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "investigation not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if err := core.ArchiveInvestigation(d.DB, id); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	// 回读最新状态
	inv, err := core.GetInvestigation(d.DB, id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, inv)
}

// ---- /api/investigations/:id/unarchive (POST) ----

func (d *Deps) handleUnarchiveInvestigation(c *gin.Context) {
	id := c.Param("id")
	if _, err := core.GetInvestigation(d.DB, id); err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "investigation not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if err := core.UnarchiveInvestigation(d.DB, id); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	inv, err := core.GetInvestigation(d.DB, id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, inv)
}

// ---- /api/investigations/:id/entries (GET) ----

func (d *Deps) handleListInvestigationEntries(c *gin.Context) {
	id := c.Param("id")
	if _, err := core.GetInvestigation(d.DB, id); err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "investigation not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	entries, err := core.ListEntries(d.DB, id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if entries == nil {
		entries = []core.InvestigationEntry{}
	}
	c.JSON(http.StatusOK, entries)
}

// ---- /api/investigations/:id/entries (POST) ----

type createEntryRequest struct {
	Type    string `json:"type" binding:"required"`
	Content string `json:"content" binding:"required"`
}

func (d *Deps) handleCreateInvestigationEntry(c *gin.Context) {
	id := c.Param("id")
	var req createEntryRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	// TODO: 接入 auth 后用 user id；当前无认证用 "user"
	entry, err := core.CreateEntry(d.DB, id, req.Type, req.Content, "user")
	if err != nil {
		switch {
		case errors.Is(err, gorm.ErrRecordNotFound):
			c.JSON(http.StatusNotFound, gin.H{"error": "investigation not found"})
		case errors.Is(err, core.ErrInvestigationArchived):
			c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
		default:
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		}
		return
	}
	c.JSON(http.StatusCreated, entry)
}

// ---- /api/investigations/:id/approve (POST) ----
// 用户确认 awaiting_approval 的调查，触发执行写操作并进入 verifying。

func (d *Deps) handleApproveInvestigation(c *gin.Context) {
	id := c.Param("id")
	inv, err := core.GetInvestigation(d.DB, id)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "investigation not found"})
		return
	}
	if inv.Status != core.StatusAwaitingApproval {
		c.JSON(http.StatusConflict, gin.H{"error": "investigation is not awaiting approval, current status: " + inv.Status})
		return
	}

	// 记录用户确认
	core.CreateEntry(d.DB, id, "note", "用户确认执行修复方案", "user")

	// 推进到 executing 状态
	updated, err := core.UpdateInvestigationStatus(d.DB, id, core.StatusExecuting, "user")
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// 直接启动执行流水线
	go agents.RunExecutionPipeline(d.DB, d.Engine, updated)

	c.JSON(http.StatusOK, updated)
}

// ---- /api/investigations/:id/reject (POST) ----
// 用户拒绝方案，带反馈信息回到 Generator 重新生成。

type rejectInvestigationRequest struct {
	Feedback string `json:"feedback"`
}

func (d *Deps) handleRejectInvestigation(c *gin.Context) {
	id := c.Param("id")
	inv, err := core.GetInvestigation(d.DB, id)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "investigation not found"})
		return
	}
	if inv.Status != core.StatusAwaitingApproval {
		c.JSON(http.StatusConflict, gin.H{"error": "investigation is not awaiting approval, current status: " + inv.Status})
		return
	}

	var req rejectInvestigationRequest
	c.ShouldBindJSON(&req)

	feedback := "用户拒绝了修复方案"
	if req.Feedback != "" {
		feedback += "：" + req.Feedback
	}
	core.CreateEntry(d.DB, id, "review", feedback, "user")

	// 回到 generating 状态（会自动触发 Generator 重新生成）
	updated, err := core.UpdateInvestigationStatus(d.DB, id, core.StatusGenerating, "user")
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, updated)
}

// ---- /api/investigations/:id/diagnose (POST) ----
// 手动触发 Explorer Agent 诊断。open/resolved/stale 状态可触发。

func (d *Deps) handleDiagnoseInvestigation(c *gin.Context) {
	id := c.Param("id")
	inv, err := core.GetInvestigation(d.DB, id)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "investigation not found"})
		return
	}

	allowed := map[string]bool{
		core.StatusOpen:     true,
		core.StatusResolved: true,
		core.StatusStale:    true,
	}
	if !allowed[inv.Status] {
		c.JSON(http.StatusConflict, gin.H{"error": "当前状态 " + inv.Status + " 不允许触发诊断"})
		return
	}

	core.CreateEntry(d.DB, id, "note", "用户手动触发诊断", "user")

	updated, err := core.UpdateInvestigationStatus(d.DB, id, core.StatusExploring, "user")
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	go agents.RunExplorer(d.DB, d.Engine, updated)

	c.JSON(http.StatusOK, updated)
}

