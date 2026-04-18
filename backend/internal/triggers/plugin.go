// Package triggers 统一所有告警/事件输入源的抽象。
//
// 插件分两类：
//   - WebhookPlugin：被动接收 HTTP POST（UptimeKuma / AlertManager / Grafana / CI-CD 等）
//   - ActivePlugin（Phase 2+）：主动产生 Event（定时巡检 / 主动拉取）
//
// 共享约定：
//   - 插件"类型"由 Go 代码在启动时 Register 到 Registry（静态，编译期可见）。
//   - 插件"实例配置"（enabled / secret_token / JSONB config）存于 plugin_configs 表，
//     Web 面板增删改；同一类型通常只有一条实例配置（Phase 1 不支持多实例）。
package triggers

import (
	"net/http"

	"github.com/lulaide/orca/internal/core"
)

// Plugin 是所有触发插件的基础接口。
type Plugin interface {
	// Name 是插件类型的唯一标识。
	// 同时作为 Webhook URL 路径 (/api/webhooks/:plugin) 和 plugin_configs.plugin_name。
	// 规范：小写短横线，如 "uptime-kuma"。
	Name() string

	// Description 面板展示用的人类可读说明。
	Description() string
}

// WebhookPlugin 是被动 HTTP 入参型。
// Orca 共享一个路由 /api/webhooks/:plugin，按 name 分发到具体实现的 Parse。
type WebhookPlugin interface {
	Plugin

	// Parse 把原始请求 body + header 解析为 ParseResult。
	//
	// 返回约定：
	//   - Event == nil：告诉调用方"这次 payload 不产生事件"（例如 UptimeKuma 的 up 心跳），
	//     webhook handler 会返 200 忽略。
	//   - Event != nil：会被 CreateEvent + Router.Dispatch。
	//   - error 非空：handler 返 400，认为 payload 非法。
	Parse(body []byte, headers http.Header) (*ParseResult, error)
}

// ParseResult 是 Parse 的返回结构。
//
// Ignore=true 或 Input=nil 都表示"本次 payload 应被忽略"（例如 UptimeKuma up 心跳），
// webhook handler 会返 200。Input 非 nil 时，handler 直接 CreateEvent + Dispatch。
type ParseResult struct {
	// Ignore 明确表示忽略（优先级高于 Input）。
	Ignore bool

	// Input 解析出的 Event 参数；nil 视为 Ignore。
	// Source / Severity / Title / Payload / RelatedServices / DedupKey 由插件填。
	// DedupKey 用于 60 秒窗口去重，空字符串表示不参与去重。
	Input *core.CreateEventInput
}

// --- Phase 2+ 预留：主动型插件 ---
// type ActivePlugin interface {
//     Plugin
//     Start(ctx context.Context, emit func(*core.Event)) error
// }
