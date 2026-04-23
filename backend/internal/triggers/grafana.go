package triggers

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"github.com/lulaide/orca/internal/core"
)

// Grafana 处理 Grafana Alerting 的 Webhook 通知。
// Grafana 联系点配置：Type = Webhook，URL = https://orca.example.com/api/webhooks/grafana
// HTTP Header: X-Orca-Token: <secret>
type Grafana struct{}

func (Grafana) Name() string        { return "grafana" }
func (Grafana) Description() string { return "Grafana Alerting Webhook 告警通知" }

type grafanaPayload struct {
	Status       string          `json:"status"` // "firing" | "resolved"
	Alerts       []grafanaAlert  `json:"alerts"`
	GroupKey     string          `json:"groupKey"`
	Title        string          `json:"title"`
	Message      string          `json:"message"`
	CommonLabels map[string]string `json:"commonLabels"`
}

type grafanaAlert struct {
	Status       string            `json:"status"`
	Labels       map[string]string `json:"labels"`
	Annotations  map[string]string `json:"annotations"`
	StartsAt     string            `json:"startsAt"`
	EndsAt       string            `json:"endsAt"`
	Fingerprint  string            `json:"fingerprint"`
	DashboardURL string            `json:"dashboardURL"`
	PanelURL     string            `json:"panelURL"`
}

func (Grafana) Parse(body []byte, headers http.Header) (*ParseResult, error) {
	var p grafanaPayload
	if err := json.Unmarshal(body, &p); err != nil {
		return nil, fmt.Errorf("invalid grafana payload: %w", err)
	}

	if p.Status == "resolved" {
		return &ParseResult{Ignore: true}, nil
	}

	if len(p.Alerts) == 0 {
		return &ParseResult{Ignore: true}, nil
	}

	alert := p.Alerts[0]
	alertName := alert.Labels["alertname"]
	if alertName == "" {
		alertName = p.Title
	}
	severity := mapGrafanaSeverity(alert.Labels["severity"])
	namespace := alert.Labels["namespace"]

	title := fmt.Sprintf("Grafana: %s", alertName)
	if namespace != "" {
		title = fmt.Sprintf("Grafana: %s (%s)", alertName, namespace)
	}

	summary := alert.Annotations["summary"]
	if summary == "" {
		summary = p.Message
	}
	if summary != "" {
		title = title + " — " + truncate(summary, 80)
	}

	var related []string
	if svc := alert.Labels["service"]; svc != "" {
		related = append(related, svc)
	}
	if job := alert.Labels["job"]; job != "" && len(related) == 0 {
		related = append(related, job)
	}

	fingerprint := alert.Fingerprint
	if fingerprint == "" {
		fingerprint = p.GroupKey
	}
	dedupKey := fmt.Sprintf("grafana:%s:%s", alertName, fingerprint)

	return &ParseResult{
		Input: &core.CreateEventInput{
			Source:          "grafana",
			Severity:        severity,
			Title:           title,
			Payload:         body,
			RelatedServices: related,
			DedupKey:        dedupKey,
		},
	}, nil
}

func mapGrafanaSeverity(s string) string {
	switch strings.ToLower(s) {
	case "critical", "error":
		return "critical"
	case "warning", "warn":
		return "warning"
	default:
		return "warning" // Grafana 默认当 warning
	}
}
