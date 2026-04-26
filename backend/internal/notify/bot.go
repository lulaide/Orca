package notify

import (
	"fmt"
	"log"
	"strings"
	"time"
	"unicode/utf8"

	"gorm.io/gorm"

	"github.com/lulaide/orca/internal/core"
)

// BotHandler 处理飞书机器人交互命令。
type BotHandler struct {
	db   *gorm.DB
	lark *LarkNotifier
}

// NewBotHandler 创建机器人命令处理器。
func NewBotHandler(db *gorm.DB, lark *LarkNotifier) *BotHandler {
	return &BotHandler{db: db, lark: lark}
}

// HandleMessage 解析命令并发送回复。
func (b *BotHandler) HandleMessage(text, chatID string) {
	text = strings.TrimSpace(text)

	switch {
	case text == "帮助" || text == "help" || text == "":
		b.cmdHelp(chatID)
	case text == "调查列表" || text == "列出调查" || text == "调查":
		b.cmdListInvestigations(chatID, "active")
	case text == "已解决":
		b.cmdListInvestigations(chatID, "resolved")
	case text == "全部调查":
		b.cmdListInvestigations(chatID, "all")
	case strings.HasPrefix(text, "查看 ") || strings.HasPrefix(text, "查看"):
		idPrefix := strings.TrimSpace(strings.TrimPrefix(text, "查看"))
		if idPrefix == "" {
			b.cmdHelp(chatID)
		} else {
			b.cmdGetInvestigation(chatID, idPrefix)
		}
	case text == "事件列表" || text == "事件" || text == "列出事件":
		b.cmdListEvents(chatID)
	default:
		b.cmdHelp(chatID)
	}
}

func (b *BotHandler) cmdHelp(chatID string) {
	content := "**调查列表** — 进行中的调查\n" +
		"**已解决** — 已解决的调查\n" +
		"**全部调查** — 所有调查\n" +
		"**查看 <ID>** — 调查详情（输入前几位即可）\n" +
		"**事件列表** — 最近事件\n" +
		"**帮助** — 显示本帮助"

	if err := b.lark.SendCardToChat(chatID, "🐋 Orca 命令", content, "blue"); err != nil {
		log.Printf("Bot: send help failed: %v", err)
	}
}

func (b *BotHandler) cmdListInvestigations(chatID, view string) {
	var invView core.InvestigationView
	var title string
	switch view {
	case "active":
		invView = core.ViewActive
		title = "🔍 进行中的调查"
	case "resolved":
		invView = core.ViewResolved
		title = "✅ 已解决的调查"
	default:
		invView = core.ViewAll
		title = "📋 全部调查"
	}

	invs, err := core.ListInvestigations(b.db, core.ListInvestigationsOpts{
		View:  invView,
		Limit: 10,
	})
	if err != nil {
		log.Printf("Bot: list investigations failed: %v", err)
		return
	}

	if len(invs) == 0 {
		if err := b.lark.SendCardToChat(chatID, title, "暂无调查", "blue"); err != nil {
			log.Printf("Bot: send empty list failed: %v", err)
		}
		return
	}

	content := b.formatInvestigationList(invs)
	if err := b.lark.SendCardToChat(chatID, fmt.Sprintf("%s (%d)", title, len(invs)), content, "blue"); err != nil {
		log.Printf("Bot: send investigation list failed: %v", err)
	}
}

func (b *BotHandler) cmdGetInvestigation(chatID, idPrefix string) {
	var inv core.Investigation
	err := b.db.Where("id LIKE ?", idPrefix+"%").First(&inv).Error
	if err != nil {
		msg := fmt.Sprintf("未找到 ID 以 **%s** 开头的调查", idPrefix)
		if err := b.lark.SendCardToChat(chatID, "🔍 查看调查", msg, "orange"); err != nil {
			log.Printf("Bot: send not found failed: %v", err)
		}
		return
	}

	entries, _ := core.ListEntries(b.db, inv.ID)
	content := b.formatInvestigationDetail(&inv, entries)

	color := severityColor(inv.Severity)
	title := severityIcon(inv.Severity) + " " + truncateRune(inv.Title, 30)
	if err := b.lark.SendCardToChat(chatID, title, content, color); err != nil {
		log.Printf("Bot: send investigation detail failed: %v", err)
	}
}

func (b *BotHandler) cmdListEvents(chatID string) {
	events, err := core.ListEvents(b.db, core.ListEventsOpts{Limit: 10})
	if err != nil {
		log.Printf("Bot: list events failed: %v", err)
		return
	}

	if len(events) == 0 {
		if err := b.lark.SendCardToChat(chatID, "⚡ 最近事件", "暂无事件", "blue"); err != nil {
			log.Printf("Bot: send empty events failed: %v", err)
		}
		return
	}

	var parts []string
	for _, ev := range events {
		status := "⏳ 待处理"
		if ev.ProcessedAt != nil {
			status = "✅ 已处理"
		}
		parts = append(parts, fmt.Sprintf("%s **%s**\n%s · %s · %s",
			severityIcon(ev.Severity),
			truncateRune(ev.Title, 50),
			status, ev.Source, relativeTime(ev.CreatedAt)))
	}
	content := strings.Join(parts, "\n---\n")

	if err := b.lark.SendCardToChat(chatID, fmt.Sprintf("⚡ 最近事件 (%d)", len(events)), content, "blue"); err != nil {
		log.Printf("Bot: send events list failed: %v", err)
	}
}

func (b *BotHandler) formatInvestigationList(invs []core.Investigation) string {
	var parts []string
	for _, inv := range invs {
		parts = append(parts, fmt.Sprintf("%s **%s**\n%s · %s · ID: %s",
			severityIcon(inv.Severity),
			truncateRune(inv.Title, 50),
			statusLabel(inv.Status), relativeTime(inv.UpdatedAt),
			inv.ID[:8]))
	}
	return strings.Join(parts, "\n---\n")
}

func (b *BotHandler) formatInvestigationDetail(inv *core.Investigation, entries []core.InvestigationEntry) string {
	var parts []string

	// 基本信息
	parts = append(parts, fmt.Sprintf("**严重度** %s · **状态** %s\n**来源** %s · %s\n**ID** %s",
		severityLabel(inv.Severity), statusLabel(inv.Status),
		inv.Source, relativeTime(inv.CreatedAt),
		inv.ID[:8]))

	// 描述
	if inv.Description != "" {
		parts = append(parts, "---\n"+larkifyMarkdown(inv.Description))
	}

	// 根因 + 解决方案
	if inv.RootCause != nil && *inv.RootCause != "" {
		parts = append(parts, "---\n**根因**\n"+larkifyMarkdown(*inv.RootCause))
	}
	if inv.Solution != nil && *inv.Solution != "" {
		parts = append(parts, "**解决方案**\n"+larkifyMarkdown(*inv.Solution))
	}

	// 时间线 — 全部显示
	if len(entries) > 0 {
		parts = append(parts, fmt.Sprintf("---\n**时间线** (%d 条)", len(entries)))
		for _, e := range entries {
			author := e.Author
			if author == "ai" {
				author = "AI"
			}
			parts = append(parts, fmt.Sprintf("• **%s** %s\n  %s · %s",
				entryTypeLabel(e.Type),
				larkifyMarkdown(e.Content),
				author, relativeTime(e.CreatedAt)))
		}
	}

	return strings.Join(parts, "\n")
}

// truncateRune 按 rune 截断，避免切断 UTF-8 字符。
func truncateRune(s string, maxRunes int) string {
	if utf8.RuneCountInString(s) <= maxRunes {
		return s
	}
	runes := []rune(s)
	return string(runes[:maxRunes]) + "…"
}

func severityIcon(s string) string {
	switch s {
	case "critical":
		return "🔴"
	case "warning":
		return "🟡"
	default:
		return "🔵"
	}
}

func severityLabel(s string) string {
	switch s {
	case "critical":
		return "严重"
	case "warning":
		return "警告"
	default:
		return "信息"
	}
}

func statusLabel(s string) string {
	switch s {
	case "open":
		return "待处理"
	case "investigating":
		return "排查中"
	case "resolved":
		return "已解决"
	case "stale":
		return "已过期"
	default:
		return s
	}
}

func entryTypeLabel(t string) string {
	switch t {
	case "discovery":
		return "发现"
	case "action":
		return "操作"
	case "resolution":
		return "结论"
	case "note":
		return "备注"
	default:
		return t
	}
}

func relativeTime(t time.Time) string {
	d := time.Since(t)
	switch {
	case d < time.Minute:
		return "刚刚"
	case d < time.Hour:
		return fmt.Sprintf("%d 分钟前", int(d.Minutes()))
	case d < 24*time.Hour:
		return fmt.Sprintf("%d 小时前", int(d.Hours()))
	default:
		return fmt.Sprintf("%d 天前", int(d.Hours()/24))
	}
}
