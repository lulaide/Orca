package api

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"github.com/lulaide/orca/internal/core"
)

// ---- GET /api/events ----
//
// 列表查询。支持 query param：
//   ?source=uptime-kuma
//   ?severity=critical
//   ?processed=true|false
//   ?limit=50  (默认 50，上限 200)
func (d *Deps) handleListEvents(c *gin.Context) {
	opts := core.ListEventsOpts{
		Source:   c.Query("source"),
		Severity: c.Query("severity"),
		Limit:    50,
	}
	if p := c.Query("processed"); p != "" {
		b := p == "true" || p == "1"
		opts.Processed = &b
	}
	if l := c.Query("limit"); l != "" {
		if n, err := strconv.Atoi(l); err == nil && n > 0 {
			if n > 200 {
				n = 200
			}
			opts.Limit = n
		}
	}

	list, err := core.ListEvents(d.DB, opts)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if list == nil {
		list = []core.Event{}
	}
	c.JSON(http.StatusOK, list)
}

// ---- GET /api/events/:id ----
//
// 详情：含反向查"本次事件产生的 Investigation 列表"。
func (d *Deps) handleGetEvent(c *gin.Context) {
	id := c.Param("id")
	ev, err := core.GetEvent(d.DB, id)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "event not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	invs, err := core.ListInvestigationsByEvent(d.DB, id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if invs == nil {
		invs = []core.Investigation{}
	}
	c.JSON(http.StatusOK, gin.H{
		"event":          ev,
		"investigations": invs,
	})
}
