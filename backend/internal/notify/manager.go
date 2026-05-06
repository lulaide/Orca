package notify

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"strings"
	"sync"

	larkim "github.com/larksuite/oapi-sdk-go/v3/service/im/v1"
	"github.com/larksuite/oapi-sdk-go/v3/event/dispatcher"
	"github.com/larksuite/oapi-sdk-go/v3/event/dispatcher/callback"
	larkws "github.com/larksuite/oapi-sdk-go/v3/ws"
	"gorm.io/gorm"

	"github.com/lulaide/orca/internal/core"
	"github.com/lulaide/orca/internal/db"
	"github.com/lulaide/orca/internal/llm"
	"github.com/lulaide/orca/internal/tools"
)

// LarkConfig 飞书通知配置，存 settings 表 key="notification_lark"。
type LarkConfig struct {
	Enabled   bool   `json:"enabled"`
	AppID     string `json:"app_id"`
	AppSecret string `json:"app_secret"`
	ChatID    string `json:"chat_id"`
}

// Manager 管理通知发送 + 机器人交互。
type Manager struct {
	db   *gorm.DB
	lark *LarkNotifier
	cfg  LarkConfig
	bot  *BotHandler

	// WebSocket 长连接
	wsCancel context.CancelFunc
	wsMu     sync.Mutex

	// onApprove 飞书审批回调，由 main.go 注入（启动 RunExecutionPipeline）。
	onApprove func(inv *core.Investigation)
	// engine LLM 引擎，用于飞书 AI 对话。
	engine *llm.Engine
}

// SetOnApprove 注册飞书审批确认回调。
func (m *Manager) SetOnApprove(fn func(inv *core.Investigation)) {
	m.onApprove = fn
}

// SetEngine 注入 LLM 引擎，启用飞书 AI 对话。
// 同时更新已有 BotHandler 的 engine。
func (m *Manager) SetEngine(engine *llm.Engine) {
	m.engine = engine
	if m.bot != nil {
		m.bot.engine = engine
	}
}

// NewManager 创建通知管理器并从 DB 加载配置。
func NewManager(gormDB *gorm.DB) *Manager {
	m := &Manager{db: gormDB}
	m.Reload()
	return m
}

// Reload 从 settings 表重新加载配置，并重启 Bot 连接。
func (m *Manager) Reload() {
	m.StopBot()

	var cfg LarkConfig
	if found, _ := db.LoadSetting(m.db, "notification_lark", &cfg); found && cfg.Enabled {
		m.cfg = cfg
		m.lark = NewLarkNotifier(cfg.AppID, cfg.AppSecret, cfg.ChatID)
		m.bot = NewBotHandler(m.db, m.lark, m.engine)
		// 注册飞书审批卡片发送器（供 approval.go 在飞书对话中使用）
		larkRef := m.lark
		tools.LarkApprovalSender = func(chatID, actionID, toolName, description, risk string) {
			if larkRef != nil {
				if err := larkRef.SendToolApprovalCard(chatID, actionID, toolName, description, risk); err != nil {
					log.Printf("Notify: send tool approval card failed: %v", err)
				}
			}
		}
		log.Printf("Notify: lark enabled (chat_id=%s)", cfg.ChatID)
		m.StartBot()
	} else {
		m.cfg = LarkConfig{}
		m.lark = nil
		m.bot = nil
	}
}

// StartBot 启动飞书 WebSocket 长连接接收消息。
func (m *Manager) StartBot() {
	m.wsMu.Lock()
	defer m.wsMu.Unlock()

	if m.cfg.AppID == "" || m.cfg.AppSecret == "" || m.bot == nil {
		return
	}

	// 创建事件分发器
	handler := dispatcher.NewEventDispatcher("", "").
		OnP2MessageReceiveV1(func(ctx context.Context, event *larkim.P2MessageReceiveV1) error {
			return m.handleMessageEvent(event)
		}).
		OnP2CardActionTrigger(func(ctx context.Context, event *callback.CardActionTriggerEvent) (*callback.CardActionTriggerResponse, error) {
			return m.handleCardAction(event)
		})

	ctx, cancel := context.WithCancel(context.Background())
	m.wsCancel = cancel

	wsClient := larkws.NewClient(m.cfg.AppID, m.cfg.AppSecret,
		larkws.WithEventHandler(handler),
		larkws.WithAutoReconnect(true),
	)

	go func() {
		log.Println("Bot: starting WebSocket connection...")
		if err := wsClient.Start(ctx); err != nil {
			if ctx.Err() == nil {
				log.Printf("Bot: WebSocket error: %v", err)
			}
		}
	}()
}

// StopBot 关闭 WebSocket 连接。
func (m *Manager) StopBot() {
	m.wsMu.Lock()
	defer m.wsMu.Unlock()

	if m.wsCancel != nil {
		m.wsCancel()
		m.wsCancel = nil
		log.Println("Bot: WebSocket connection stopped")
	}
}

// handleMessageEvent 处理飞书消息事件。
func (m *Manager) handleMessageEvent(event *larkim.P2MessageReceiveV1) error {
	if event == nil || event.Event == nil || event.Event.Message == nil {
		return nil
	}

	msg := event.Event.Message

	// 只处理文本消息
	if msg.MessageType == nil || *msg.MessageType != "text" {
		return nil
	}

	chatID := ""
	if msg.ChatId != nil {
		chatID = *msg.ChatId
	}
	if chatID == "" {
		return nil
	}

	// 解析消息内容（JSON 格式 {"text":"xxx"}）
	text := ""
	if msg.Content != nil {
		var content struct {
			Text string `json:"text"`
		}
		if err := json.Unmarshal([]byte(*msg.Content), &content); err == nil {
			text = content.Text
		}
	}

	// 去掉 @机器人 的 mention 文本
	if msg.Mentions != nil {
		for _, mention := range msg.Mentions {
			if mention.Name != nil {
				text = strings.ReplaceAll(text, "@"+*mention.Name, "")
			}
			if mention.Key != nil {
				text = strings.ReplaceAll(text, *mention.Key, "")
			}
		}
	}
	text = strings.TrimSpace(text)

	// 交给 BotHandler 处理
	if m.bot != nil {
		go m.bot.HandleMessage(text, chatID)
	}
	return nil
}

// NotifyEvent 异步发送事件通知。
func (m *Manager) NotifyEvent(ev *core.Event) {
	if m.lark == nil {
		return
	}
	go func() {
		color := severityColor(ev.Severity)
		title := fmt.Sprintf("🔔 新事件 [%s]", severityLabel(ev.Severity))
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
		title := fmt.Sprintf("🔍 新调查 [%s]", severityLabel(inv.Severity))
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

// SendCard 发送自定义卡片通知（供 patrol 等模块使用）。
func (m *Manager) SendCard(title, content, color string) {
	if m.lark == nil {
		return
	}
	if err := m.lark.SendCard(title, content, color); err != nil {
		log.Printf("Notify: send card failed: %v", err)
	}
}

// NotifyApprovalRequired 发送交互审批卡片到飞书群。
func (m *Manager) NotifyApprovalRequired(inv *core.Investigation) {
	if m.lark == nil || m.cfg.ChatID == "" {
		return
	}
	go func() {
		// 从时间线找最新的 solution entry 解析描述和操作
		entries, err := core.ListEntries(m.db, inv.ID)
		if err != nil {
			log.Printf("Notify: list entries for approval card failed: %v", err)
			return
		}

		description := ""
		var actionsList []map[string]string
		for i := len(entries) - 1; i >= 0; i-- {
			if entries[i].Type == "solution" {
				var payload struct {
					Description string `json:"description"`
					Actions     []struct {
						Tool string `json:"tool"`
						Args string `json:"args"`
					} `json:"actions"`
				}
				if json.Unmarshal([]byte(entries[i].Content), &payload) == nil {
					description = payload.Description
					for _, a := range payload.Actions {
						actionsList = append(actionsList, map[string]string{"tool": a.Tool, "args": a.Args})
					}
				}
				break
			}
		}

		if err := m.lark.SendApprovalCardForInvestigation(m.cfg.ChatID, inv, description, actionsList); err != nil {
			log.Printf("Notify: send approval card failed: %v", err)
		}
	}()
}

// handleCardAction 处理飞书卡片按钮回调（确认/拒绝审批）。
func (m *Manager) handleCardAction(event *callback.CardActionTriggerEvent) (*callback.CardActionTriggerResponse, error) {
	if event == nil || event.Event == nil || event.Event.Action == nil {
		return nil, nil
	}

	action := event.Event.Action
	value := action.Value

	actionType, _ := value["action"].(string)
	if actionType == "" {
		return nil, nil
	}

	log.Printf("Bot: card action received: %s", actionType)

	// 工具执行审批（飞书对话中的写操作）
	if actionType == "approve_tool" || actionType == "reject_tool" {
		return m.handleToolApproval(actionType, value)
	}

	invID, _ := value["investigation_id"].(string)
	if invID == "" {
		return nil, nil
	}

	inv, err := core.GetInvestigation(m.db, invID)
	if err != nil {
		log.Printf("Bot: get investigation failed: %v", err)
		return &callback.CardActionTriggerResponse{
			Toast: &callback.Toast{Type: "error", Content: "调查不存在"},
		}, nil
	}

	if inv.Status != core.StatusAwaitingApproval {
		return &callback.CardActionTriggerResponse{
			Toast: &callback.Toast{Type: "warning", Content: "调查当前状态为 " + inv.Status + "，无法操作"},
		}, nil
	}

	// 获取方案内容用于结果卡片
	entries, _ := core.ListEntries(m.db, invID)
	var solutionDesc string
	for i := len(entries) - 1; i >= 0; i-- {
		if entries[i].Type == "solution" {
			var payload struct {
				Description string `json:"description"`
			}
			if json.Unmarshal([]byte(entries[i].Content), &payload) == nil {
				solutionDesc = larkifyMarkdown(payload.Description)
			}
			break
		}
	}

	switch actionType {
	case "approve":
		core.CreateEntry(m.db, invID, "note", "用户通过飞书确认执行修复方案", "user")
		updated, err := core.UpdateInvestigationStatus(m.db, invID, core.StatusExecuting, "user")
		if err != nil {
			return &callback.CardActionTriggerResponse{
				Toast: &callback.Toast{Type: "error", Content: "操作失败: " + err.Error()},
			}, nil
		}

		if m.onApprove != nil {
			m.onApprove(updated)
		}

		resultCard := buildResultCard(
			"✅ 方案已确认 — "+inv.Title, solutionDesc, "green",
			"**状态：** 已确认执行，正在自动修复中...",
		)

		return &callback.CardActionTriggerResponse{
			Toast: &callback.Toast{Type: "success", Content: "已确认执行，正在处理..."},
			Card:  &callback.Card{Type: "raw", Data: resultCard},
		}, nil

	case "reject":
		feedback := "用户通过飞书拒绝了修复方案"
		if reason, ok := action.FormValue["reason"].(string); ok && reason != "" {
			feedback += "：" + reason
		}
		core.CreateEntry(m.db, invID, "review", feedback, "user")
		core.UpdateInvestigationStatus(m.db, invID, core.StatusGenerating, "user")

		rejectNote := "**状态：** 已拒绝，正在重新生成方案..."
		if reason, ok := action.FormValue["reason"].(string); ok && reason != "" {
			rejectNote = fmt.Sprintf("**状态：** 已拒绝\n**原因：** %s\n\n正在重新生成方案...", reason)
		}

		resultCard := buildResultCard(
			"❌ 方案已拒绝 — "+inv.Title, solutionDesc, "red",
			rejectNote,
		)

		return &callback.CardActionTriggerResponse{
			Toast: &callback.Toast{Type: "info", Content: "已拒绝，将重新生成方案"},
			Card:  &callback.Card{Type: "raw", Data: resultCard},
		}, nil
	}

	return nil, nil
}

// handleToolApproval 处理飞书对话中工具执行的确认/拒绝。
func (m *Manager) handleToolApproval(actionType string, value map[string]interface{}) (*callback.CardActionTriggerResponse, error) {
	actionID, _ := value["action_id"].(string)
	if actionID == "" {
		return nil, nil
	}

	if tools.ApprovalMgr == nil {
		return &callback.CardActionTriggerResponse{
			Toast: &callback.Toast{Type: "error", Content: "审批管理器未初始化"},
		}, nil
	}

	switch actionType {
	case "approve_tool":
		if err := tools.ApprovalMgr.Approve(actionID, "lark_user"); err != nil {
			return &callback.CardActionTriggerResponse{
				Toast: &callback.Toast{Type: "error", Content: "操作失败: " + err.Error()},
			}, nil
		}
		resultCard := buildResultCard("✅ 操作已确认", "操作已批准执行", "green", "")
		return &callback.CardActionTriggerResponse{
			Toast: &callback.Toast{Type: "success", Content: "已确认执行"},
			Card:  &callback.Card{Type: "raw", Data: resultCard},
		}, nil

	case "reject_tool":
		if err := tools.ApprovalMgr.Reject(actionID, "lark_user"); err != nil {
			return &callback.CardActionTriggerResponse{
				Toast: &callback.Toast{Type: "error", Content: "操作失败: " + err.Error()},
			}, nil
		}
		resultCard := buildResultCard("❌ 操作已拒绝", "操作已被拒绝", "red", "")
		return &callback.CardActionTriggerResponse{
			Toast: &callback.Toast{Type: "info", Content: "已拒绝"},
			Card:  &callback.Card{Type: "raw", Data: resultCard},
		}, nil
	}

	return nil, nil
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
