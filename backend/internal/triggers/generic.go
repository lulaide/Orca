package triggers

import (
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/lulaide/orca/internal/core"
)

// GenericWebhook 是通用 Webhook 触发器。
// 接受任意 JSON payload，尝试从常见字段名提取事件信息。
// 适用于自定义告警源、CI/CD 系统、自建监控等。
//
// 支持的字段名（按优先级）：
//   - title / subject / name / message → 事件标题
//   - severity / level / priority → 严重程度（critical/warning/info）
//   - service / app / application / source → 关联服务
type GenericWebhook struct{}

func (GenericWebhook) Name() string        { return "generic" }
func (GenericWebhook) Description() string { return "通用 Webhook — 接受任意 JSON，自动提取事件信息" }

func (GenericWebhook) Parse(body []byte, headers http.Header) (*ParseResult, error) {
	var raw map[string]any
	if err := json.Unmarshal(body, &raw); err != nil {
		return nil, fmt.Errorf("invalid JSON payload: %w", err)
	}

	title := firstString(raw, "title", "subject", "name", "message", "msg", "text", "alert", "summary")
	if title == "" {
		title = "Generic Webhook 事件"
	}

	severity := firstString(raw, "severity", "level", "priority", "status")
	severity = normalizeSeverity(severity)

	service := firstString(raw, "service", "app", "application", "source", "project", "repo")
	var related []string
	if service != "" {
		related = append(related, service)
	}

	dedupKey := ""
	if id := firstString(raw, "id", "event_id", "alert_id", "fingerprint", "dedup_key"); id != "" {
		dedupKey = "generic:" + id
	}

	return &ParseResult{
		Input: &core.CreateEventInput{
			Source:          "generic",
			Severity:        severity,
			Title:           truncate(title, 200),
			Payload:         body,
			RelatedServices: related,
			DedupKey:        dedupKey,
		},
	}, nil
}

// firstString 从 map 中按 key 优先级取第一个非空字符串值。
func firstString(m map[string]any, keys ...string) string {
	for _, k := range keys {
		if v, ok := m[k]; ok {
			switch s := v.(type) {
			case string:
				if s != "" {
					return s
				}
			case float64:
				return fmt.Sprintf("%.0f", s)
			}
		}
	}
	return ""
}

func normalizeSeverity(s string) string {
	switch s {
	case "critical", "error", "fatal", "emergency", "CRITICAL", "ERROR":
		return "critical"
	case "warning", "warn", "WARNING", "WARN":
		return "warning"
	default:
		return "info"
	}
}
