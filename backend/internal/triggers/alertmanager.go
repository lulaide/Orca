package triggers

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"github.com/lulaide/orca/internal/core"
)

// AlertManager 处理 Prometheus AlertManager 的 Webhook 通知。
// AlertManager Webhook 配置：
//
//	receivers:
//	  - name: orca
//	    webhook_configs:
//	      - url: https://orca.example.com/api/webhooks/alertmanager
//	        http_config:
//	          headers:
//	            X-Orca-Token: <secret>
type AlertManager struct{}

func (AlertManager) Name() string        { return "alertmanager" }
func (AlertManager) Description() string { return "Prometheus AlertManager Webhook 告警通知" }

type amPayload struct {
	Status   string    `json:"status"` // "firing" | "resolved"
	Alerts   []amAlert `json:"alerts"`
	GroupKey string    `json:"groupKey"`
}

type amAlert struct {
	Status       string            `json:"status"`
	Labels       map[string]string `json:"labels"`
	Annotations  map[string]string `json:"annotations"`
	StartsAt     string            `json:"startsAt"`
	EndsAt       string            `json:"endsAt"`
	GeneratorURL string            `json:"generatorURL"`
	Fingerprint  string            `json:"fingerprint"`
}

func (AlertManager) Parse(body []byte, headers http.Header) (*ParseResult, error) {
	var p amPayload
	if err := json.Unmarshal(body, &p); err != nil {
		return nil, fmt.Errorf("invalid alertmanager payload: %w", err)
	}

	if len(p.Alerts) == 0 {
		return &ParseResult{Ignore: true}, nil
	}

	// 只处理 firing 状态的告警
	if p.Status == "resolved" {
		return &ParseResult{Ignore: true}, nil
	}

	// 取第一个 alert 作为主要信息
	alert := p.Alerts[0]
	alertName := alert.Labels["alertname"]
	severity := mapAMSeverity(alert.Labels["severity"])
	namespace := alert.Labels["namespace"]
	service := alert.Labels["service"]
	if service == "" {
		service = alert.Labels["job"]
	}

	title := fmt.Sprintf("AlertManager: %s", alertName)
	if namespace != "" {
		title = fmt.Sprintf("AlertManager: %s (%s)", alertName, namespace)
	}

	// 如果有多个 alert，在标题里注明
	if len(p.Alerts) > 1 {
		title = fmt.Sprintf("AlertManager: %s (+%d)", alertName, len(p.Alerts)-1)
	}

	summary := alert.Annotations["summary"]
	if summary == "" {
		summary = alert.Annotations["description"]
	}
	if summary != "" {
		title = title + " — " + truncate(summary, 80)
	}

	var related []string
	if service != "" {
		related = append(related, service)
	}
	if namespace != "" && service == "" {
		related = append(related, namespace)
	}

	dedupKey := fmt.Sprintf("alertmanager:%s:%s", alertName, alert.Fingerprint)

	return &ParseResult{
		Input: &core.CreateEventInput{
			Source:          "alertmanager",
			Severity:        severity,
			Title:           title,
			Payload:         body,
			RelatedServices: related,
			DedupKey:        dedupKey,
		},
	}, nil
}

func mapAMSeverity(s string) string {
	switch strings.ToLower(s) {
	case "critical", "error":
		return "critical"
	case "warning", "warn":
		return "warning"
	default:
		return "info"
	}
}
