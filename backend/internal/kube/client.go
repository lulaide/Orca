package kube

import (
	"context"
	"errors"
	"fmt"
	"log"
	"sync"
	"time"

	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/clientcmd"
)

// Mode 表示 K8s 连接方式。
type Mode string

const (
	// ModeUnset 启动时未配置 kubeconfig 且 in-cluster 探测失败，
	// 或用户主动断开连接。后台显示"未配置"。
	ModeUnset Mode = "unset"

	// ModeInCluster Pod 内使用 ServiceAccount token 连接。
	ModeInCluster Mode = "in-cluster"

	// ModeKubeconfig 使用 kubeconfig 文件/内容连接。
	ModeKubeconfig Mode = "kubeconfig"
)

// Status 暴露给后台的当前连接状态。
type Status struct {
	Mode       Mode      `json:"mode"`
	Connected  bool      `json:"connected"`
	ServerVer  string    `json:"server_version,omitempty"`
	LastError  string    `json:"last_error,omitempty"`
	ConnectedAt time.Time `json:"connected_at,omitempty"`
}

// Manager 封装 K8s 客户端，支持运行时切换连接方式。
// 所有方法都是线程安全的。
type Manager struct {
	mu          sync.RWMutex
	mode        Mode
	clientset   *kubernetes.Clientset
	config      *rest.Config
	lastError   string
	connectedAt time.Time
	serverVer   string
}

// NewManager 根据启动配置初始化 Manager，但不返回 error——
// K8s 不可用不应阻止服务启动，用户可以之后在后台手动配置。
//
// 启动逻辑（互斥，不 fallback）：
//   - kubeconfigPath 非空 → 走 kubeconfig 模式，失败记录错误进入 Unset 状态
//   - kubeconfigPath 为空 → 走 in-cluster 模式，失败静默进入 Unset 状态
func NewManager(kubeconfigPath string) *Manager {
	m := &Manager{mode: ModeUnset}

	if kubeconfigPath != "" {
		if err := m.UseKubeconfigFile(kubeconfigPath); err != nil {
			log.Printf("K8s: kubeconfig mode failed: %v (backend will show error)", err)
		}
		return m
	}

	// 未配置 kubeconfig → 尝试 in-cluster，失败不记录错误只标记未配置
	if err := m.UseInCluster(); err != nil {
		log.Printf("K8s: not running in cluster, awaiting configuration from backend")
	}
	return m
}

// UseInCluster 切换到 in-cluster 模式。
func (m *Manager) UseInCluster() error {
	cfg, err := rest.InClusterConfig()
	if err != nil {
		m.mu.Lock()
		m.mode = ModeUnset
		m.clientset = nil
		m.config = nil
		// in-cluster 失败时不记录错误（通常是"不在集群里运行"这种预期情况）
		m.lastError = ""
		m.mu.Unlock()
		return err
	}
	return m.activate(ModeInCluster, cfg)
}

// UseKubeconfigFile 从文件路径加载 kubeconfig 并切换。
func (m *Manager) UseKubeconfigFile(path string) error {
	cfg, err := clientcmd.BuildConfigFromFlags("", path)
	if err != nil {
		m.setError(fmt.Errorf("load kubeconfig %s: %w", path, err))
		return err
	}
	return m.activate(ModeKubeconfig, cfg)
}

// UseKubeconfigBytes 从 kubeconfig 字节内容加载（后台上传文件用）。
func (m *Manager) UseKubeconfigBytes(data []byte) error {
	cfg, err := clientcmd.RESTConfigFromKubeConfig(data)
	if err != nil {
		m.setError(fmt.Errorf("parse kubeconfig: %w", err))
		return err
	}
	return m.activate(ModeKubeconfig, cfg)
}

// Disconnect 主动断开当前连接，回到 Unset 状态。
func (m *Manager) Disconnect() {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.mode = ModeUnset
	m.clientset = nil
	m.config = nil
	m.lastError = ""
	m.connectedAt = time.Time{}
	m.serverVer = ""
}

// Clientset 返回当前活动的 clientset，未连接时返回 nil。
// 调用方必须判空后使用。
func (m *Manager) Clientset() *kubernetes.Clientset {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.clientset
}

// Status 返回当前状态快照。
func (m *Manager) Status() Status {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return Status{
		Mode:        m.mode,
		Connected:   m.clientset != nil,
		ServerVer:   m.serverVer,
		LastError:   m.lastError,
		ConnectedAt: m.connectedAt,
	}
}

// Ping 对当前 clientset 发一次 discovery 请求验证连通性。
// 用于后台的"测试连接"按钮。
func (m *Manager) Ping(ctx context.Context) error {
	cs := m.Clientset()
	if cs == nil {
		return errors.New("no active kubernetes client")
	}
	_, err := cs.Discovery().ServerVersion()
	return err
}

// ---- 内部 ----

// activate 用给定 config 构造 clientset 并验证连通性，成功则激活。
func (m *Manager) activate(mode Mode, cfg *rest.Config) error {
	cs, err := kubernetes.NewForConfig(cfg)
	if err != nil {
		m.setError(fmt.Errorf("create clientset: %w", err))
		return err
	}

	// 探针：立刻发一次 discovery 请求确认通信正常
	ver, err := cs.Discovery().ServerVersion()
	if err != nil {
		m.setError(fmt.Errorf("probe server: %w", err))
		return err
	}

	m.mu.Lock()
	defer m.mu.Unlock()
	m.mode = mode
	m.clientset = cs
	m.config = cfg
	m.lastError = ""
	m.connectedAt = time.Now()
	m.serverVer = ver.String()
	log.Printf("K8s: connected (%s, server %s)", mode, m.serverVer)
	return nil
}

// setError 记录错误并进入 Unset 状态。
func (m *Manager) setError(err error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.mode = ModeUnset
	m.clientset = nil
	m.config = nil
	m.lastError = err.Error()
}

