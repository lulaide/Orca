package api

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"github.com/lulaide/orca/internal/core"
)

// GET /api/patrols
func (d *Deps) handleListPatrols(c *gin.Context) {
	configs, err := core.ListPatrolConfigs(d.DB)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if configs == nil {
		configs = []core.PatrolConfig{}
	}
	c.JSON(http.StatusOK, configs)
}

// GET /api/patrols/:id
func (d *Deps) handleGetPatrol(c *gin.Context) {
	cfg, err := core.GetPatrolConfig(d.DB, c.Param("id"))
	if err != nil || cfg == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
		return
	}
	c.JSON(http.StatusOK, cfg)
}

// POST /api/patrols
func (d *Deps) handleCreatePatrol(c *gin.Context) {
	var body core.PatrolConfig
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := core.CreatePatrolConfig(d.DB, &body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if d.Patrol != nil {
		d.Patrol.Reload()
	}
	c.JSON(http.StatusCreated, body)
}

// PUT /api/patrols/:id
func (d *Deps) handleUpdatePatrol(c *gin.Context) {
	var body map[string]any
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	cfg, err := core.UpdatePatrolConfig(d.DB, c.Param("id"), body)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if d.Patrol != nil {
		d.Patrol.Reload()
	}
	c.JSON(http.StatusOK, cfg)
}

// DELETE /api/patrols/:id
func (d *Deps) handleDeletePatrol(c *gin.Context) {
	if err := core.DeletePatrolConfig(d.DB, c.Param("id")); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if d.Patrol != nil {
		d.Patrol.Reload()
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// POST /api/patrols/:id/run
func (d *Deps) handleRunPatrol(c *gin.Context) {
	if d.Patrol == nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "scheduler not initialized"})
		return
	}
	if err := d.Patrol.RunNow(c.Param("id")); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusAccepted, gin.H{"status": "started"})
}

// GET /api/patrols/:id/runs
func (d *Deps) handleListPatrolRuns(c *gin.Context) {
	runs, err := core.ListPatrolRuns(d.DB, c.Param("id"), 20)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if runs == nil {
		runs = []core.PatrolRun{}
	}
	c.JSON(http.StatusOK, runs)
}
