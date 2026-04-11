package llm

import (
	"context"
	"fmt"

	"github.com/cloudwego/eino-ext/components/model/claude"
	"github.com/cloudwego/eino-ext/components/model/openai"
	"github.com/cloudwego/eino/components/model"

	"github.com/lulaide/orca/internal/config"
)

// Provider 类型常量。
const (
	ProviderOpenAI    = "openai"
	ProviderAnthropic = "anthropic"
)

// buildChatModel 根据配置构造一个 eino ToolCallingChatModel。
// 返回的实例是不可变的,可以在多个 goroutine 之间共享;
// 需要绑定工具时调 WithTools 获得派生实例。
func buildChatModel(ctx context.Context, cfg config.LLMConfig) (model.ToolCallingChatModel, error) {
	if cfg.APIKey == "" {
		return nil, fmt.Errorf("api_key is empty")
	}
	if cfg.Model == "" {
		return nil, fmt.Errorf("model is empty")
	}

	switch cfg.Provider {
	case ProviderOpenAI, "":
		return buildOpenAI(ctx, cfg)
	case ProviderAnthropic:
		return buildAnthropic(ctx, cfg)
	default:
		return nil, fmt.Errorf("unknown provider: %q (supported: openai, anthropic)", cfg.Provider)
	}
}

func buildOpenAI(ctx context.Context, cfg config.LLMConfig) (model.ToolCallingChatModel, error) {
	oc := &openai.ChatModelConfig{
		APIKey: cfg.APIKey,
		Model:  cfg.Model,
	}
	if cfg.Endpoint != "" {
		oc.BaseURL = cfg.Endpoint
	}
	cm, err := openai.NewChatModel(ctx, oc)
	if err != nil {
		return nil, fmt.Errorf("create openai chat model: %w", err)
	}
	return cm, nil
}

func buildAnthropic(ctx context.Context, cfg config.LLMConfig) (model.ToolCallingChatModel, error) {
	cc := &claude.Config{
		APIKey:    cfg.APIKey,
		Model:     cfg.Model,
		MaxTokens: 4096, // Anthropic 要求必填,这里给一个合理默认值
	}
	if cfg.Endpoint != "" {
		endpoint := cfg.Endpoint
		cc.BaseURL = &endpoint
	}
	cm, err := claude.NewChatModel(ctx, cc)
	if err != nil {
		return nil, fmt.Errorf("create anthropic chat model: %w", err)
	}
	return cm, nil
}
