package llm

import (
	"context"
	"errors"
	"log"
	"sync"
	"time"

	"github.com/cloudwego/eino/components/model"

	"github.com/lulaide/orca/internal/config"
)

// Status 暴露给后台的当前 LLM 状态。
// 注意:API Key 不会出现在 Status 里,避免泄漏。
type Status struct {
	Provider      string    `json:"provider"`
	Model         string    `json:"model"`
	Endpoint      string    `json:"endpoint,omitempty"`
	MaxIterations int       `json:"max_iterations"`
	Configured    bool      `json:"configured"`
	LastError     string    `json:"last_error,omitempty"`
	ConfiguredAt  time.Time `json:"configured_at,omitempty"`
}

// Manager 持有当前活动的 ChatModel 实例,支持运行时切换 provider/model/api_key。
// 所有方法都是线程安全的。
// Manager 本身不做持久化——上层(main.go / API handler)负责从 settings 表读写。
type Manager struct {
	mu           sync.RWMutex
	chatModel    model.ToolCallingChatModel
	current      config.LLMConfig
	lastError    string
	configuredAt time.Time
}

// NewManager 根据启动配置初始化 Manager。
// 和 kube.Manager 一样,初始化失败不会阻止服务启动——
// LLM 不可用时用户可以之后在后台手动配置。
func NewManager(cfg config.LLMConfig) *Manager {
	m := &Manager{}
	if err := m.Apply(cfg); err != nil {
		log.Printf("LLM: initial config invalid: %v (awaiting configuration from backend)", err)
	}
	return m
}

// Apply 用新配置重新构造 ChatModel 并原子替换当前实例。
// 构造失败时保持当前实例不变,只更新 lastError。
func (m *Manager) Apply(cfg config.LLMConfig) error {
	cm, err := buildChatModel(context.Background(), cfg)
	if err != nil {
		m.mu.Lock()
		m.lastError = err.Error()
		m.mu.Unlock()
		return err
	}

	m.mu.Lock()
	defer m.mu.Unlock()
	m.chatModel = cm
	m.current = cfg
	m.lastError = ""
	m.configuredAt = time.Now()
	log.Printf("LLM: configured (%s, model=%s)", cfg.Provider, cfg.Model)
	return nil
}

// ChatModel 返回当前活动的 ChatModel 实例,未配置时返回 nil。
// 调用方必须判空后使用。
func (m *Manager) ChatModel() model.ToolCallingChatModel {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.chatModel
}

// Current 返回当前生效的完整配置(含 API Key)。
// 用于 API handler 持久化到 settings 表,不应暴露给前端。
func (m *Manager) Current() config.LLMConfig {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.current
}

// MaxIterations 返回当前配置的 Agentic Loop 最大迭代轮数。
// 未配置或配置 <= 0 时返回默认值 20。
func (m *Manager) MaxIterations() int {
	m.mu.RLock()
	defer m.mu.RUnlock()
	if m.current.MaxIterations <= 0 {
		return 20
	}
	return m.current.MaxIterations
}

// Status 返回当前状态快照(不含敏感字段)。
func (m *Manager) Status() Status {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return Status{
		Provider:      m.current.Provider,
		Model:         m.current.Model,
		Endpoint:      m.current.Endpoint,
		MaxIterations: m.current.MaxIterations,
		Configured:    m.chatModel != nil,
		LastError:     m.lastError,
		ConfiguredAt:  m.configuredAt,
	}
}

// ErrNotConfigured 在未配置 LLM 时被调用方使用。
var ErrNotConfigured = errors.New("llm is not configured")
