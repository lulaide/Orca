package api

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"github.com/lulaide/orca/internal/core"
)

// GET /api/skills
func (d *Deps) handleListSkills(c *gin.Context) {
	skills, err := core.ListSkills(d.DB)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, skills)
}

// GET /api/skills/:name
func (d *Deps) handleGetSkill(c *gin.Context) {
	name := c.Param("name")
	skill, err := core.GetSkill(d.DB, name)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if skill == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "skill not found"})
		return
	}
	c.JSON(http.StatusOK, skill)
}

// PATCH /api/skills/:name
func (d *Deps) handleUpdateSkill(c *gin.Context) {
	name := c.Param("name")
	skill, err := core.GetSkill(d.DB, name)
	if err != nil || skill == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "skill not found"})
		return
	}

	var body struct {
		Description *string `json:"description"`
		Content     *string `json:"content"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if body.Description != nil {
		skill.Description = *body.Description
	}
	if body.Content != nil {
		skill.Content = *body.Content
	}

	if err := core.UpsertSkill(d.DB, skill); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, skill)
}

// DELETE /api/skills/:name
func (d *Deps) handleDeleteSkill(c *gin.Context) {
	name := c.Param("name")
	if err := core.DeleteSkill(d.DB, name); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// GET /api/skills/:name/refs/:ref
func (d *Deps) handleGetSkillRef(c *gin.Context) {
	name := c.Param("name")
	ref := c.Param("ref")
	content, err := core.GetSkillRef(d.DB, name, ref)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"content": content})
}

// PUT /api/skills/:name/refs/:ref
func (d *Deps) handleUpdateSkillRef(c *gin.Context) {
	name := c.Param("name")
	ref := c.Param("ref")

	var body struct {
		Content string `json:"content"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if err := core.WriteSkillRef(d.DB, name, ref, body.Content); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// DELETE /api/skills/:name/refs/:ref
func (d *Deps) handleDeleteSkillRef(c *gin.Context) {
	name := c.Param("name")
	ref := c.Param("ref")
	if err := core.DeleteSkillRef(d.DB, name, ref); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}
