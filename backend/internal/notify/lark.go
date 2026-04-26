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

// larkifyMarkdown 把飞书不支持的 markdown 语法转换为支持的格式。
func larkifyMarkdown(s string) string {
	// 去掉三反引号代码块标记
	for strings.Contains(s, "```") {
		start := strings.Index(s, "```")
		end := strings.Index(s[start+3:], "```")
		if end < 0 {
			break
		}
		s = s[:start] + s[start+3:start+3+end] + s[start+3+end+3:]
	}
	// 单反引号 `xxx` → **xxx**
	var result strings.Builder
	inCode := false
	for i := 0; i < len(s); i++ {
		if s[i] == '`' {
			result.WriteString("**")
			inCode = !inCode
		} else {
			result.WriteByte(s[i])
		}
	}
	return result.String()
}
