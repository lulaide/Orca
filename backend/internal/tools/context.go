package tools

import "context"

// 工具执行时可用的 per-request 上下文数据。
//
// 这些 key 用 context.WithValue 注入，handler 通过 ctx 读取（而不是走全局变量，
// 因为请求间需要隔离）。全局资源（DB / KubeMgr）继续走包级变量。

type ctxKey int

const (
	// ConversationIDKey 标识当前 LLM 调用所属的对话 ID。
	// 由 api/handlers.go 的 handleChat 在调 Engine.Run 前注入。
	ConversationIDKey ctxKey = iota
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
