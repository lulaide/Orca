package triggers

import "sync"

// Registry 管理所有"已编译进来"的 Plugin 类型。
// 启动时 Register，运行时 Webhook handler 按名字查找。
//
// 线程安全：Register 通常只在启动时调用一次，但加锁以防万一。
type Registry struct {
	mu      sync.RWMutex
	plugins map[string]Plugin
}

// NewRegistry 建一个空 registry。
func NewRegistry() *Registry {
	return &Registry{plugins: make(map[string]Plugin)}
}

// Register 注册一个插件。重名会被覆盖（通常表示 bug）。
func (r *Registry) Register(p Plugin) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.plugins[p.Name()] = p
}

// All 返回所有已注册的插件（用于面板列表）。
func (r *Registry) All() []Plugin {
	r.mu.RLock()
	defer r.mu.RUnlock()
	out := make([]Plugin, 0, len(r.plugins))
	for _, p := range r.plugins {
		out = append(out, p)
	}
	return out
}

// Get 按 name 查插件（通用）。
func (r *Registry) Get(name string) (Plugin, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	p, ok := r.plugins[name]
	return p, ok
}

// Webhook 查一个 Webhook 型插件。非 webhook 类型的会返 false。
func (r *Registry) Webhook(name string) (WebhookPlugin, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	p, ok := r.plugins[name]
	if !ok {
		return nil, false
	}
	w, ok := p.(WebhookPlugin)
	return w, ok
}
