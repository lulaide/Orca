package tools

import "context"

// 工具执行时可用的 per-request 上下文数据。
//
// 这些 key 用 context.WithValue 注入，handler 通过 ctx 读取（而不是走全局变量，
// 因为请求间需要隔离）。全局资源（DB / KubeMgr）继续走包级变量。

type ctxKey int

// SSEEmitFunc 是 SSE 推送函数类型。写工具在阻塞等审批前用它推事件给前端。
type SSEEmitFunc func(event string, data any) error

const (
	ConversationIDKey ctxKey = iota
	EventIDKey
	SSEEmitKey // Chat 模式注入 SSE emit 函数
)

// ConversationIDFromContext 从 ctx 读取对话 ID；未注入时返回空串。
func ConversationIDFromContext(ctx context.Context) string {
	if ctx == nil {
		return ""
	}
	if v, ok := ctx.Value(ConversationIDKey).(string); ok {
		return v
	}
	return ""
}

// EventIDFromContext 从 ctx 读取事件 ID；未注入时返回空串。
func EventIDFromContext(ctx context.Context) string {
	if ctx == nil {
		return ""
	}
	if v, ok := ctx.Value(EventIDKey).(string); ok {
		return v
	}
	return ""
}

// SSEEmitFromContext 从 ctx 读取 SSE 推送函数；未注入时返回 nil。
func SSEEmitFromContext(ctx context.Context) SSEEmitFunc {
	if ctx == nil {
		return nil
	}
	if v, ok := ctx.Value(SSEEmitKey).(SSEEmitFunc); ok {
		return v
	}
	return nil
}
