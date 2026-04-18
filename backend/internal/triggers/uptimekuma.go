package triggers

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"github.com/lulaide/orca/internal/core"
)

// UptimeKuma 实现 WebhookPlugin，处理 UptimeKuma 的通知 Webhook。
// UptimeKuma 在 Settings → Notifications 里配 Webhook URL，监控项 down/up
// 时会按心跳频率推送 JSON。
type UptimeKuma struct{}

func (UptimeKuma) Name() string { return "uptime-kuma" }

func (UptimeKuma) Description() string {
	return "接入 Uptime Kuma 的通知 Webhook：监控掉线时触发 Agent 自动排查。"
}

// ukPayload 是 UptimeKuma Webhook 的核心字段（只覆盖常用部分）。
// 参考 https://github.com/louislam/uptime-kuma/wiki/Integration：
//
//	{
//	  "heartbeat": { "status": 0|1, "msg": "...", "time": "..." },
//	  "monitor":   { "id": 42, "name": "api-gateway", "url": "https://...", "type": "http" },
//	  "msg": "human readable"
//	}
//
// status 语义：0 = DOWN, 1 = UP, 2 = PENDING, 3 = MAINTENANCE。
type ukPayload struct {
	Heartbeat struct {
		Status *int   `json:"status"`
		Msg    string `json:"msg"`
		Time   string `json:"time"`
	} `json:"heartbeat"`
	Monitor struct {
		ID   any    `json:"id"` // UK 有时是 int，有时是 string
		Name string `json:"name"`
		URL  string `json:"url"`
		Type string `json:"type"`
	} `json:"monitor"`
	Msg string `json:"msg"`
}

func (UptimeKuma) Parse(body []byte, _ http.Header) (*ParseResult, error) {
	var p ukPayload
	if err := json.Unmarshal(body, &p); err != nil {
		return nil, fmt.Errorf("invalid uptime-kuma payload: %w", err)
	}

	// 没有 heartbeat.status：兼容"通用测试消息"这种 payload——忽略。
	if p.Heartbeat.Status == nil {
		return &ParseResult{Ignore: true}, nil
	}
	status := *p.Heartbeat.Status

	// up 心跳不触发事件（会淹没系统）。pending/maintenance 暂时也不触发。
	if status != 0 {
		return &ParseResult{Ignore: true}, nil
	}

	monitorName := strings.TrimSpace(p.Monitor.Name)
	if monitorName == "" {
		monitorName = "unknown-monitor"
	}
	monitorID := stringifyID(p.Monitor.ID)

	title := "Uptime Kuma: " + monitorName + " is DOWN"
	if p.Heartbeat.Msg != "" {
		title = title + " — " + p.Heartbeat.Msg
	}

	// related_services 先按 URL host 推一个（UK 没有服务概念，只有监控项）。
	var related []string
	if p.Monitor.URL != "" {
		if host := hostFromURL(p.Monitor.URL); host != "" {
			related = append(related, host)
		}
	}

	return &ParseResult{
		Input: &core.CreateEventInput{
			Source:          "uptime-kuma",
			Severity:        "critical",
			Title:           title,
			Payload:         body,
			RelatedServices: related,
			DedupKey:        "uptime-kuma:monitor:" + monitorID + ":down",
		},
	}, nil
}

func stringifyID(v any) string {
	switch x := v.(type) {
	case string:
		if x == "" {
			return "unknown"
		}
		return x
	case float64:
		return strconv.FormatInt(int64(x), 10)
	case int:
		return strconv.Itoa(x)
	case int64:
		return strconv.FormatInt(x, 10)
	case nil:
		return "unknown"
	default:
		return fmt.Sprintf("%v", x)
	}
}

func hostFromURL(raw string) string {
	u, err := url.Parse(raw)
	if err != nil {
		return ""
	}
	return u.Host
}
