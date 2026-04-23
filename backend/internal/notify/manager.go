package notify

import (
	"fmt"
	"log"
	"strings"

	"gorm.io/gorm"

	"github.com/lulaide/orca/internal/core"
	"github.com/lulaide/orca/internal/db"
)

// LarkConfig 飞书通知配置，存 settings 表 key="notification_lark"。
type LarkConfig struct {
	Enabled   bool   `json:"enabled"`
	AppID     string `json:"app_id"`
	AppSecret string `json:"app_secret"`
	ChatID    string `json:"chat_id"`
}

// Manager 管理通知发送。
type Manager struct {
	db   *gorm.DB
	lark *LarkNotifier
	cfg  LarkConfig
}

// NewManager 创建通知管理器并从 DB 加载配置。
func NewManager(gormDB *gorm.DB) *Manager {
	m := &Manager{db: gormDB}
	m.Reload()
	return m
}

// Reload 从 settings 表重新加载配置。
func (m *Manager) Reload() {
	var cfg LarkConfig
	if found, _ := db.LoadSetting(m.db, "notification_lark", &cfg); found && cfg.Enabled {
		m.cfg = cfg
		m.lark = NewLarkNotifier(cfg.AppID, cfg.AppSecret, cfg.ChatID)
		log.Printf("Notify: lark enabled (chat_id=%s)", cfg.ChatID)
	} else {
		m.cfg = LarkConfig{}
		m.lark = nil
	}
}

// NotifyEvent 异步发送事件通知。
func (m *Manager) NotifyEvent(ev *core.Event) {
	if m.lark == nil {
		return
	}
	go func() {
		color := severityColor(ev.Severity)
		title := fmt.Sprintf("🔔 新事件 [%s]", strings.ToUpper(ev.Severity))
		content := fmt.Sprintf("**%s**\n\n来源: %s\n时间: %s",
			ev.Title, ev.Source, ev.CreatedAt.Format("01-02 15:04"))

		if err := m.lark.SendCard(title, content, color); err != nil {
			log.Printf("Notify: send event failed: %v", err)
		}
	}()
}

// NotifyInvestigationCreated 异步发送调查创建通知。
func (m *Manager) NotifyInvestigationCreated(inv *core.Investigation) {
	if m.lark == nil {
		return
	}
	go func() {
		color := severityColor(inv.Severity)
		title := fmt.Sprintf("🔍 新调查 [%s]", strings.ToUpper(inv.Severity))
		content := fmt.Sprintf("**%s**\n\n%s",
			inv.Title, larkifyMarkdown(inv.Description))

		if err := m.lark.SendCard(title, content, color); err != nil {
			log.Printf("Notify: send investigation created failed: %v", err)
		}
	}()
}

// NotifyInvestigationResolved 异步发送调查解决通知。
func (m *Manager) NotifyInvestigationResolved(inv *core.Investigation) {
	if m.lark == nil {
		return
	}
	go func() {
		title := "✅ 调查已解决"
		var parts []string
		parts = append(parts, fmt.Sprintf("**%s**", inv.Title))
		if inv.RootCause != nil && *inv.RootCause != "" {
			parts = append(parts, fmt.Sprintf("**根因**: %s", larkifyMarkdown(*inv.RootCause)))
		}
		if inv.Solution != nil && *inv.Solution != "" {
			parts = append(parts, fmt.Sprintf("**方案**: %s", larkifyMarkdown(*inv.Solution)))
		}
		content := strings.Join(parts, "\n\n")

		if err := m.lark.SendCard(title, content, "green"); err != nil {
			log.Printf("Notify: send investigation resolved failed: %v", err)
		}
	}()
}

// SendTest 发送测试消息。
func (m *Manager) SendTest() error {
	if m.lark == nil {
		return fmt.Errorf("飞书通知未配置或未启用")
	}
	return m.lark.SendText("🐋 Orca 通知测试 — 如果你看到这条消息，说明飞书通知已配置成功。")
}

func severityColor(s string) string {
	switch s {
	case "critical":
		return "red"
	case "warning":
		return "orange"
	default:
		return "blue"
	}
}
