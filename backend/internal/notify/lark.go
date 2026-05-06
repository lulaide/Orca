// Package notify 负责向外部 IM 发送通知。
package notify

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	lark "github.com/larksuite/oapi-sdk-go/v3"
	larkcard "github.com/larksuite/oapi-sdk-go/v3/card"
	larkim "github.com/larksuite/oapi-sdk-go/v3/service/im/v1"

	"github.com/lulaide/orca/internal/core"
)

// LarkNotifier 通过飞书应用机器人发送消息。
type LarkNotifier struct {
	client *lark.Client
	chatID string
}

// NewLarkNotifier 创建飞书通知器。
func NewLarkNotifier(appID, appSecret, chatID string) *LarkNotifier {
	client := lark.NewClient(appID, appSecret)
	return &LarkNotifier{client: client, chatID: chatID}
}

// SendCard 发送飞书卡片消息到默认群。
func (l *LarkNotifier) SendCard(title, content, color string) error {
	return l.SendCardToChat(l.chatID, title, content, color)
}

// SendCardToChat 发送飞书卡片消息到指定群。
func (l *LarkNotifier) SendCardToChat(chatID, title, content, color string) error {
	card := larkcard.NewMessageCard().
		Config(larkcard.NewMessageCardConfig().WideScreenMode(true)).
		Header(larkcard.NewMessageCardHeader().
			Template(color).
			Title(larkcard.NewMessageCardPlainText().Content(title))).
		Elements([]larkcard.MessageCardElement{
			larkcard.NewMessageCardMarkdown().Content(content),
		}).Build()

	cardJSON, err := json.Marshal(card)
	if err != nil {
		return fmt.Errorf("marshal card: %w", err)
	}

	req := larkim.NewCreateMessageReqBuilder().
		ReceiveIdType("chat_id").
		Body(larkim.NewCreateMessageReqBodyBuilder().
			ReceiveId(chatID).
			MsgType("interactive").
			Content(string(cardJSON)).
			Build()).
		Build()

	resp, err := l.client.Im.Message.Create(context.Background(), req)
	if err != nil {
		return fmt.Errorf("send message: %w", err)
	}
	if !resp.Success() {
		return fmt.Errorf("lark api error %d: %s", resp.Code, resp.Msg)
	}
	return nil
}

// SendTextToChat 发送纯文本消息到指定群。
func (l *LarkNotifier) SendTextToChat(chatID, text string) error {
	content, _ := json.Marshal(map[string]string{"text": text})

	req := larkim.NewCreateMessageReqBuilder().
		ReceiveIdType("chat_id").
		Body(larkim.NewCreateMessageReqBodyBuilder().
			ReceiveId(chatID).
			MsgType("text").
			Content(string(content)).
			Build()).
		Build()

	resp, err := l.client.Im.Message.Create(context.Background(), req)
	if err != nil {
		return err
	}
	if !resp.Success() {
		return fmt.Errorf("lark api error %d: %s", resp.Code, resp.Msg)
	}
	return nil
}

// SendText 发送纯文本消息（用于测试）。
func (l *LarkNotifier) SendText(text string) error {
	content, _ := json.Marshal(map[string]string{"text": text})

	req := larkim.NewCreateMessageReqBuilder().
		ReceiveIdType("chat_id").
		Body(larkim.NewCreateMessageReqBodyBuilder().
			ReceiveId(l.chatID).
			MsgType("text").
			Content(string(content)).
			Build()).
		Build()

	resp, err := l.client.Im.Message.Create(context.Background(), req)
	if err != nil {
		return err
	}
	if !resp.Success() {
		return fmt.Errorf("lark api error %d: %s", resp.Code, resp.Msg)
	}
	return nil
}

// SendApprovalCardForInvestigation 发送带确认/拒绝按钮的交互审批卡片。
// 确认按钮直接回传，拒绝按钮包裹在 Form 中带 Input 输入拒绝原因。
func (l *LarkNotifier) SendApprovalCardForInvestigation(chatID string, inv *core.Investigation, description string, actions []map[string]string) error {
	var actionsText strings.Builder
	for _, a := range actions {
		actionsText.WriteString(fmt.Sprintf("• **%s** %s\n", a["tool"], a["args"]))
	}

	content := fmt.Sprintf("**%s**\n\n%s", inv.Title, larkifyMarkdown(description))
	if actionsText.Len() > 0 {
		content += "\n\n**待执行操作：**\n" + actionsText.String()
	}

	sevLabel := severityLabel(inv.Severity)

	card := map[string]any{
		"config": map[string]any{"wide_screen_mode": true},
		"header": map[string]any{
			"title":    map[string]any{"tag": "plain_text", "content": fmt.Sprintf("⚡ 方案待确认 [%s]", sevLabel)},
			"template": "orange",
		},
		"elements": []any{
			map[string]any{"tag": "markdown", "content": content},
			map[string]any{
				"tag": "action",
				"actions": []any{
					map[string]any{
						"tag":  "button",
						"text": map[string]any{"tag": "plain_text", "content": "✅ 确认执行"},
						"type": "primary",
						"value": map[string]any{
							"action":          "approve",
							"investigation_id": inv.ID,
						},
						"confirm": map[string]any{
							"title": map[string]any{"tag": "plain_text", "content": "确认执行"},
							"text":  map[string]any{"tag": "plain_text", "content": "确认后将自动执行修复操作，请确保已了解方案内容"},
						},
					},
				},
			},
			map[string]any{"tag": "hr"},
			map[string]any{
				"tag":  "form",
				"name": "reject_form",
				"elements": []any{
					map[string]any{
						"tag":         "input",
						"name":        "reason",
						"placeholder": map[string]any{"tag": "plain_text", "content": "拒绝原因和改进方向（选填）"},
					},
					map[string]any{
						"tag":         "button",
						"name":        "reject_btn",
						"text":        map[string]any{"tag": "plain_text", "content": "❌ 拒绝方案"},
						"type":        "danger",
						"action_type": "form_submit",
						"value": map[string]any{
							"action":          "reject",
							"investigation_id": inv.ID,
						},
						"confirm": map[string]any{
							"title": map[string]any{"tag": "plain_text", "content": "确认拒绝"},
							"text":  map[string]any{"tag": "plain_text", "content": "拒绝后将根据反馈重新生成方案"},
						},
					},
				},
			},
		},
	}

	return l.sendRawCard(chatID, card)
}

// sendRawCard 发送原始 JSON 卡片。
func (l *LarkNotifier) sendRawCard(chatID string, card map[string]any) error {
	cardJSON, err := json.Marshal(card)
	if err != nil {
		return fmt.Errorf("marshal card: %w", err)
	}

	req := larkim.NewCreateMessageReqBuilder().
		ReceiveIdType("chat_id").
		Body(larkim.NewCreateMessageReqBodyBuilder().
			ReceiveId(chatID).
			MsgType("interactive").
			Content(string(cardJSON)).
			Build()).
		Build()

	resp, err := l.client.Im.Message.Create(context.Background(), req)
	if err != nil {
		return fmt.Errorf("send message: %w", err)
	}
	if !resp.Success() {
		return fmt.Errorf("lark api error %d: %s", resp.Code, resp.Msg)
	}
	return nil
}

// SendToolApprovalCard 发送工具执行审批卡片（用于飞书对话中的写操作）。
func (l *LarkNotifier) SendToolApprovalCard(chatID, actionID, toolName, description, risk string) error {
	riskLabel := "低"
	color := "orange"
	if risk == "medium" || risk == "high" {
		riskLabel = "中"
		color = "red"
	}

	content := fmt.Sprintf("**%s**\n\n工具：**%s**\n风险：%s", description, toolName, riskLabel)

	card := map[string]any{
		"config": map[string]any{"wide_screen_mode": true},
		"header": map[string]any{
			"title":    map[string]any{"tag": "plain_text", "content": "🔐 操作待确认"},
			"template": color,
		},
		"elements": []any{
			map[string]any{"tag": "markdown", "content": content},
			map[string]any{
				"tag": "action",
				"actions": []any{
					map[string]any{
						"tag":  "button",
						"text": map[string]any{"tag": "plain_text", "content": "✅ 确认执行"},
						"type": "primary",
						"value": map[string]any{
							"action":    "approve_tool",
							"action_id": actionID,
						},
						"confirm": map[string]any{
							"title": map[string]any{"tag": "plain_text", "content": "确认执行"},
							"text":  map[string]any{"tag": "plain_text", "content": description},
						},
					},
					map[string]any{
						"tag":  "button",
						"text": map[string]any{"tag": "plain_text", "content": "❌ 拒绝"},
						"type": "danger",
						"value": map[string]any{
							"action":    "reject_tool",
							"action_id": actionID,
						},
					},
				},
			},
		},
	}

	return l.sendRawCard(chatID, card)
}

// buildResultCard 构建操作完成后的替换卡片（无按钮），防止重复点击。
func buildResultCard(title, content, color, status string) map[string]any {
	return map[string]any{
		"config": map[string]any{"wide_screen_mode": true},
		"header": map[string]any{
			"title":    map[string]any{"tag": "plain_text", "content": title},
			"template": color,
		},
		"elements": []any{
			map[string]any{"tag": "markdown", "content": content},
			map[string]any{"tag": "hr"},
			map[string]any{"tag": "markdown", "content": status},
		},
	}
}

// larkifyMarkdown 把飞书不支持的 markdown 语法转换为支持的格式。
// 飞书卡片 markdown 不支持：### 标题、有序列表（1. 2. 3.）、代码块（```）、表格、链接文字。
func larkifyMarkdown(s string) string {
	lines := strings.Split(s, "\n")
	var result []string
	inCodeBlock := false
	inTable := false
	var tableHeaders []string
	var tableRows [][]string

	flushTable := func() {
		if len(tableHeaders) > 0 && len(tableRows) > 0 {
			for _, row := range tableRows {
				var parts []string
				for i, cell := range row {
					if i < len(tableHeaders) {
						parts = append(parts, fmt.Sprintf("**%s**: %s", tableHeaders[i], cell))
					} else {
						parts = append(parts, cell)
					}
				}
				result = append(result, "• "+strings.Join(parts, " | "))
			}
		}
		tableHeaders = nil
		tableRows = nil
		inTable = false
	}

	for _, line := range lines {
		trimmed := strings.TrimSpace(line)

		// 代码块
		if strings.HasPrefix(trimmed, "```") {
			if inTable {
				flushTable()
			}
			inCodeBlock = !inCodeBlock
			continue
		}
		if inCodeBlock {
			result = append(result, line)
			continue
		}

		// 表格检测
		if strings.HasPrefix(trimmed, "|") && strings.HasSuffix(trimmed, "|") {
			cells := parseTableRow(trimmed)
			// 分隔行（|---|---|）跳过
			if isTableSeparator(trimmed) {
				continue
			}
			if !inTable {
				// 第一行是表头
				inTable = true
				tableHeaders = cells
			} else {
				tableRows = append(tableRows, cells)
			}
			continue
		} else if inTable {
			flushTable()
		}

		// ### 标题 → **加粗**
		if strings.HasPrefix(trimmed, "### ") {
			result = append(result, "**"+strings.TrimPrefix(trimmed, "### ")+"**")
			continue
		}
		if strings.HasPrefix(trimmed, "## ") {
			result = append(result, "**"+strings.TrimPrefix(trimmed, "## ")+"**")
			continue
		}

		// 有序列表 "1. xxx" → "• xxx"
		if len(trimmed) > 2 && trimmed[0] >= '0' && trimmed[0] <= '9' && strings.Contains(trimmed[:3], ".") {
			idx := strings.Index(trimmed, ".")
			if idx > 0 && idx < 3 && idx+1 < len(trimmed) {
				result = append(result, "• "+strings.TrimSpace(trimmed[idx+1:]))
				continue
			}
		}

		result = append(result, line)
	}
	if inTable {
		flushTable()
	}

	// 单反引号 `xxx` → **xxx**
	joined := strings.Join(result, "\n")
	var sb strings.Builder
	for i := 0; i < len(joined); i++ {
		if joined[i] == '`' {
			sb.WriteString("**")
		} else {
			sb.WriteByte(joined[i])
		}
	}
	return sb.String()
}

func parseTableRow(line string) []string {
	line = strings.TrimPrefix(line, "|")
	line = strings.TrimSuffix(line, "|")
	parts := strings.Split(line, "|")
	cells := make([]string, 0, len(parts))
	for _, p := range parts {
		cells = append(cells, strings.TrimSpace(p))
	}
	return cells
}

func isTableSeparator(line string) bool {
	for _, c := range line {
		if c != '|' && c != '-' && c != ':' && c != ' ' {
			return false
		}
	}
	return strings.Contains(line, "---")
}
