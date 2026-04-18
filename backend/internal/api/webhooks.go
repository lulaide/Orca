package api

import (
	"errors"
	"io"
	"log"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"github.com/lulaide/orca/internal/core"
)

// dedupWindow 是同一 dedup_key 的去重窗口。UptimeKuma 会按心跳周期
// 每秒重复推一次同一事件，这里统一压到 60 秒粒度。
const dedupWindow = 60 * time.Second

// ---- POST /api/webhooks/:plugin ----
//
// 通用 Webhook 入口：
//   1. :plugin 路径找插件实例（triggers.Registry）
//   2. header X-Orca-Token 匹配 plugin_configs.secret_token（且 enabled=true）
//   3. Plugin.Parse 解析 body → ParseResult
//   4. ParseResult.Ignore 或 Input=nil → 200 ignored（不入库）
//   5. 60s 内同 dedup_key 已存在 → 200 duplicate，返同一 event_id，不再 dispatch
//   6. 否则 CreateEvent + Router.Dispatch，返 202 accepted
func (d *Deps) handleWebhook(c *gin.Context) {
	name := c.Param("plugin")

	plugin, ok := d.Triggers.Webhook(name)
	if !ok {
		c.JSON(http.StatusNotFound, gin.H{"error": "plugin not found: " + name})
		return
	}

	// 查 plugin_configs：必须 enabled 且 token 匹配
	var cfg core.PluginConfig
	if err := d.DB.Where("plugin_name = ?", name).First(&cfg).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "plugin not configured"})
		} else {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		}
		return
	}
	if !cfg.Enabled {
		c.JSON(http.StatusForbidden, gin.H{"error": "plugin is disabled"})
		return
	}
	token := c.GetHeader("X-Orca-Token")
	if cfg.SecretToken == "" || token != cfg.SecretToken {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid token"})
		return
	}

	// 读 body（限制大小以防恶意大 payload）
	body, err := io.ReadAll(io.LimitReader(c.Request.Body, 1<<20)) // 1 MiB
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "read body: " + err.Error()})
		return
	}

	result, err := plugin.Parse(body, c.Request.Header)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if result == nil || result.Ignore || result.Input == nil {
		c.JSON(http.StatusOK, gin.H{"status": "ignored"})
		return
	}

	// 去重：同 dedup_key 60s 内已有 Event，不再建
	if result.Input.DedupKey != "" {
		existing, err := core.FindRecentDuplicate(d.DB, result.Input.DedupKey, dedupWindow)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "dedup check: " + err.Error()})
			return
		}
		if existing != nil {
			log.Printf("webhook %s: duplicate within %s, returning existing event %s",
				name, dedupWindow, existing.ID)
			c.JSON(http.StatusOK, gin.H{
				"status":   "duplicate",
				"event_id": existing.ID,
			})
			return
		}
	}

	ev, err := core.CreateEvent(d.DB, *result.Input)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "create event: " + err.Error()})
		return
	}
	log.Printf("webhook %s: event %s created (severity=%s)", name, ev.ID, ev.Severity)

	// 异步启动 Agent Loop
	if d.Router != nil {
		d.Router.Dispatch(ev)
	} else {
		log.Printf("webhook %s: no router configured, event %s will not be processed", name, ev.ID)
	}

	c.JSON(http.StatusAccepted, gin.H{
		"status":   "accepted",
		"event_id": ev.ID,
	})
}
