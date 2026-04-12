// Package tools 提供 Agent 可用工具的注册表和执行框架。
//
// Registry 是"Agent 能做什么"的单一真相源:
//   - 给 LLM 看的工具元数据(ToolInfos)
//   - 真正执行工具的处理函数(Handler)
//   - 执行入口,负责按名字分发调用
//
// 典型用法:
//
//	reg := tools.NewRegistry()
//	tools.RegisterKubernetesTools(reg, kubeMgr)
//	// ... 其他 skill 的工具
//
//	// LLM 调用时
//	cm, _ := baseModel.WithTools(reg.ToolInfos())
//	resp, _ := cm.Generate(ctx, messages)
//	for _, call := range resp.ToolCalls {
//	    result, _ := reg.Execute(ctx, call.Function.Name, call.Function.Arguments)
//	    // ... 追加到对话历史
//	}
package tools

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"sync"

	"github.com/cloudwego/eino/schema"
)

// Handler 是工具的执行函数。
// args 是 LLM 传来的参数,原始 JSON 字符串格式(例如 `{"namespace":"default"}`)。
// 返回值是给 LLM 看的结果字符串,通常是 JSON 或人类可读的文本。
type Handler func(ctx context.Context, args string) (string, error)

// Tool 把"给 LLM 看的元数据"和"真正执行的函数"绑在一起。
type Tool struct {
	Info    *schema.ToolInfo
	Handler Handler
}

// Registry 是线程安全的工具注册表。
type Registry struct {
	mu    sync.RWMutex
	tools map[string]*Tool
}

// NewRegistry 创建一个空的注册表。
func NewRegistry() *Registry {
	return &Registry{tools: make(map[string]*Tool)}
}

// Register 注册一个工具。重名会覆盖旧的(允许运行时热更新)。
func (r *Registry) Register(info *schema.ToolInfo, h Handler) {
	if info == nil || info.Name == "" {
		return
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	r.tools[info.Name] = &Tool{Info: info, Handler: h}
}

// Unregister 按名字移除工具。用于权限变化时撤销能力。
func (r *Registry) Unregister(name string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	delete(r.tools, name)
}

// Has 检查工具是否已注册。
func (r *Registry) Has(name string) bool {
	r.mu.RLock()
	defer r.mu.RUnlock()
	_, ok := r.tools[name]
	return ok
}

// Names 返回已注册工具名的有序列表(便于日志和 UI 展示)。
func (r *Registry) Names() []string {
	r.mu.RLock()
	defer r.mu.RUnlock()
	names := make([]string, 0, len(r.tools))
	for name := range r.tools {
		names = append(names, name)
	}
	sort.Strings(names)
	return names
}

// ToolInfos 返回所有已注册工具的元数据切片,用于 baseModel.WithTools()。
// 返回顺序按名字排序,保证 LLM 看到的工具列表稳定。
func (r *Registry) ToolInfos() []*schema.ToolInfo {
	r.mu.RLock()
	defer r.mu.RUnlock()
	names := make([]string, 0, len(r.tools))
	for name := range r.tools {
		names = append(names, name)
	}
	sort.Strings(names)
	infos := make([]*schema.ToolInfo, 0, len(names))
	for _, name := range names {
		infos = append(infos, r.tools[name].Info)
	}
	return infos
}

// Execute 按名字查找工具并执行。
// LLM 返回 tool_call 时调用这个方法。
func (r *Registry) Execute(ctx context.Context, name, args string) (string, error) {
	r.mu.RLock()
	t, ok := r.tools[name]
	r.mu.RUnlock()
	if !ok {
		return "", fmt.Errorf("tool %q not found", name)
	}
	if t.Handler == nil {
		return "", fmt.Errorf("tool %q has no handler", name)
	}
	return t.Handler(ctx, args)
}

// ErrToolNotFound 在找不到工具时返回(供调用方类型断言用)。
var ErrToolNotFound = errors.New("tool not found")
