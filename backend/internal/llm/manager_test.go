package llm

import (
	"context"
	"testing"
	"time"

	"github.com/cloudwego/eino/schema"

	"github.com/lulaide/orca/internal/config"
)

// TestChatModel 验证 LLM Manager 能正常连接配置的 provider 并收到回复。
// 运行方式: cd backend && go test -v -run TestChatModel ./internal/llm
// 如果 config.yaml 里 llm.api_key 为空,测试会跳过。
func TestChatModel(t *testing.T) {
	cfg := config.Load("../../config.yaml")
	if cfg.LLM.APIKey == "" {
		t.Skip("llm.api_key not set in config.yaml, skipping")
	}

	t.Logf("provider=%s model=%s endpoint=%s",
		cfg.LLM.Provider, cfg.LLM.Model, cfg.LLM.Endpoint)

	mgr := NewManager(cfg.LLM)
	status := mgr.Status()
	if !status.Configured {
		t.Fatalf("manager not configured: %s", status.LastError)
	}

	cm := mgr.ChatModel()
	if cm == nil {
		t.Fatal("ChatModel returned nil")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	resp, err := cm.Generate(ctx, []*schema.Message{
		schema.SystemMessage("You are a helpful assistant. Reply in one short sentence."),
		schema.UserMessage("Say hello in English and tell me what model you are."),
	})
	if err != nil {
		t.Fatalf("generate: %v", err)
	}

	t.Logf("response: %s", resp.Content)
	if resp.Content == "" {
		t.Error("empty response content")
	}
	if resp.ResponseMeta != nil && resp.ResponseMeta.Usage != nil {
		u := resp.ResponseMeta.Usage
		t.Logf("tokens: prompt=%d completion=%d total=%d",
			u.PromptTokens, u.CompletionTokens, u.TotalTokens)
	}
}
