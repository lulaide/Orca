package api

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"github.com/lulaide/orca/internal/tools"
)

// POST /api/actions/:id/approve
func (d *Deps) handleApproveAction(c *gin.Context) {
	id := c.Param("id")
	if tools.ApprovalMgr == nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "approval manager not initialized"})
		return
	}
	// TODO: 从 JWT 取 userID
	if err := tools.ApprovalMgr.Approve(id, "admin"); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// POST /api/actions/:id/reject
func (d *Deps) handleRejectAction(c *gin.Context) {
	id := c.Param("id")
	if tools.ApprovalMgr == nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "approval manager not initialized"})
		return
	}
	if err := tools.ApprovalMgr.Reject(id, "admin"); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}
