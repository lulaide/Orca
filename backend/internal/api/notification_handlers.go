package api

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"github.com/lulaide/orca/internal/db"
	"github.com/lulaide/orca/internal/notify"
)

func (d *Deps) handleGetNotificationSettings(c *gin.Context) {
	var cfg notify.LarkConfig
	db.LoadSetting(d.DB, "notification_lark", &cfg)
	// 脱敏
	cfg.AppSecret = ""
	c.JSON(http.StatusOK, cfg)
}

func (d *Deps) handleUpdateNotificationSettings(c *gin.Context) {
	var cfg notify.LarkConfig
	if err := c.ShouldBindJSON(&cfg); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	// 如果 secret 为空，保留旧的
	if cfg.AppSecret == "" {
		var old notify.LarkConfig
		db.LoadSetting(d.DB, "notification_lark", &old)
		cfg.AppSecret = old.AppSecret
	}
	if err := db.SaveSetting(d.DB, "notification_lark", cfg, "admin"); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	d.Notify.Reload()
	c.JSON(http.StatusOK, gin.H{"saved": true})
}

func (d *Deps) handleTestNotification(c *gin.Context) {
	if err := d.Notify.SendTest(); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"sent": true})
}
