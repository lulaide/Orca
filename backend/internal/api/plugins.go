package api

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"github.com/lulaide/orca/internal/core"
)

// pluginListItem 是 GET /api/plugins 的一行，合并"已编译进来的类型"和"当前 DB 实例配置"。
type pluginListItem struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	Configured  bool   `json:"configured"`
	Enabled     bool   `json:"enabled"`
	HasToken    bool   `json:"has_token"`
	WebhookURL  string `json:"webhook_url,omitempty"`
}

// ---- GET /api/plugins ----
func (d *Deps) handleListPlugins(c *gin.Context) {
	all := d.Triggers.All()
	out := make([]pluginListItem, 0, len(all))
	for _, p := range all {
		item := pluginListItem{
			Name:        p.Name(),
			Description: p.Description(),
			WebhookURL:  "/api/webhooks/" + p.Name(),
		}
		var cfg core.PluginConfig
		err := d.DB.Where("plugin_name = ?", p.Name()).First(&cfg).Error
		if err == nil {
			item.Configured = true
			item.Enabled = cfg.Enabled
			item.HasToken = cfg.SecretToken != ""
		} else if !errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		out = append(out, item)
	}
	c.JSON(http.StatusOK, out)
}

// generateSecretToken 生成一个 32 字节的 hex token。
func generateSecretToken() (string, error) {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return hex.EncodeToString(buf), nil
}

// upsertPluginConfig 找不到则 create，找到则 update（不动 SecretToken）。
func upsertPluginConfig(db *gorm.DB, name string, mutate func(*core.PluginConfig)) (*core.PluginConfig, error) {
	var cfg core.PluginConfig
	err := db.Where("plugin_name = ?", name).First(&cfg).Error
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}
	created := errors.Is(err, gorm.ErrRecordNotFound)
	if created {
		cfg = core.PluginConfig{
			ID:         "plg_" + name,
			PluginName: name,
			Enabled:    true,
			CreatedAt:  time.Now(),
		}
	}
	mutate(&cfg)
	cfg.UpdatedAt = time.Now()

	if created {
		if err := db.Create(&cfg).Error; err != nil {
			return nil, err
		}
	} else {
		if err := db.Save(&cfg).Error; err != nil {
			return nil, err
		}
	}
	return &cfg, nil
}

// ---- POST /api/plugins/:name/enable ----
//
// 若从未配置过：自动创建一条带新 secret_token 的记录；已存在则仅置 enabled=true。
func (d *Deps) handleEnablePlugin(c *gin.Context) {
	name := c.Param("name")
	if _, ok := d.Triggers.Get(name); !ok {
		c.JSON(http.StatusNotFound, gin.H{"error": "plugin not found: " + name})
		return
	}
	cfg, err := upsertPluginConfig(d.DB, name, func(cfg *core.PluginConfig) {
		cfg.Enabled = true
		if cfg.SecretToken == "" {
			if tok, err := generateSecretToken(); err == nil {
				cfg.SecretToken = tok
			}
		}
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, cfg)
}

// ---- POST /api/plugins/:name/disable ----
func (d *Deps) handleDisablePlugin(c *gin.Context) {
	name := c.Param("name")
	if _, ok := d.Triggers.Get(name); !ok {
		c.JSON(http.StatusNotFound, gin.H{"error": "plugin not found: " + name})
		return
	}
	cfg, err := upsertPluginConfig(d.DB, name, func(cfg *core.PluginConfig) {
		cfg.Enabled = false
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, cfg)
}

// ---- POST /api/plugins/:name/regenerate-token ----
//
// 轮换 secret_token（旧的立即失效）。返回新 token 给用户。
func (d *Deps) handleRegeneratePluginToken(c *gin.Context) {
	name := c.Param("name")
	if _, ok := d.Triggers.Get(name); !ok {
		c.JSON(http.StatusNotFound, gin.H{"error": "plugin not found: " + name})
		return
	}
	newTok, err := generateSecretToken()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	cfg, err := upsertPluginConfig(d.DB, name, func(cfg *core.PluginConfig) {
		cfg.SecretToken = newTok
		// 轮换 token 不改 enabled 状态
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"plugin":       cfg.PluginName,
		"secret_token": cfg.SecretToken,
		"enabled":      cfg.Enabled,
	})
}

// ---- GET /api/plugins/:name/token ----
//
// 明文返回 token（Web 面板"显示 Webhook 配置"时用）。
// 没配过返回 404。
func (d *Deps) handleGetPluginToken(c *gin.Context) {
	name := c.Param("name")
	if _, ok := d.Triggers.Get(name); !ok {
		c.JSON(http.StatusNotFound, gin.H{"error": "plugin not found: " + name})
		return
	}
	var cfg core.PluginConfig
	if err := d.DB.Where("plugin_name = ?", name).First(&cfg).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "plugin not configured"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"plugin":       cfg.PluginName,
		"secret_token": cfg.SecretToken,
		"enabled":      cfg.Enabled,
	})
}
