// Package mcp 管理外部 MCP Server 连接，把它们提供的工具注册到 Agent 的工具列表里。
//
// 典型流程：
//  1. 从 DB 加载 MCPConnection 列表
//  2. 逐个建连（stdio 子进程 / SSE+OAuth）
//  3. tools/list 发现工具 → 注册到 tools.Registry（带 name/ 前缀）
//  4. Agent 推理时自然看到并调用
package mcp

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"strings"
	"sync"

	"github.com/cloudwego/eino/components/tool"
	mcpclient "github.com/mark3labs/mcp-go/client"
	"github.com/mark3labs/mcp-go/client/transport"
	"github.com/mark3labs/mcp-go/mcp"
	"gorm.io/gorm"

	einomcp "github.com/cloudwego/eino-ext/components/tool/mcp"

	"github.com/lulaide/orca/internal/core"
	"github.com/lulaide/orca/internal/db"
	"github.com/lulaide/orca/internal/tools"
)

// Manager 管理所有活跃的 MCP Server 连接。
type Manager struct {
	mu       sync.RWMutex
	registry *tools.Registry
	db       *gorm.DB
	conns    map[string]*Connection // name → active connection
	baseURL  string                 // 外部访问地址，如 "https://orca.llde.tech"

	// OAuth 流程临时状态：state → pending auth info
	oauthMu       sync.Mutex
	pendingOAuth  map[string]*PendingOAuth
}

// Connection 是一个活跃的 MCP Server 连接。
type Connection struct {
	Name      string
	ConnID    string              // DB record ID
	Client    mcpclient.MCPClient
	ToolNames []string            // 已注册到 Registry 的带前缀工具名
	cancel    context.CancelFunc
}

// PendingOAuth 存放 OAuth 授权流程的中间状态。
type PendingOAuth struct {
	ConnID       string
	ConnName     string
	State        string
	CodeVerifier string
	Handler      *OAuthHandlerRef
}

// OAuthHandlerRef 包装 mcp-go 的 OAuthHandler 引用。
type OAuthHandlerRef struct {
	// 我们不直接持有 OAuthHandler，因为它在 transport 内部。
	// 改用更简单的方式：存 code_verifier + state，回调时手动换 token。
	TokenStore *DBTokenStore
}

// ConnectionStatus 是连接状态的快照（API 返回用）。
type ConnectionStatus struct {
	Name      string   `json:"name"`
	ConnID    string   `json:"id"`
	Status    string   `json:"status"`    // "connected" | "error" | "disabled" | "needs_auth"
	Error     string   `json:"error,omitempty"`
	ToolNames []string `json:"tools"`
}

// NewManager 创建 Manager。
func NewManager(reg *tools.Registry, db *gorm.DB) *Manager {
	return &Manager{
		registry:     reg,
		db:           db,
		conns:        make(map[string]*Connection),
		pendingOAuth: make(map[string]*PendingOAuth),
	}
}

// LoadAll 从 DB 加载所有 enabled 的连接并尝试建连。
// 单个连接失败不影响其他连接。
func (m *Manager) LoadAll(ctx context.Context) error {
	conns, err := core.ListMCPConnections(m.db)
	if err != nil {
		return fmt.Errorf("list mcp connections: %w", err)
	}
	for i := range conns {
		c := &conns[i]
		if !c.Enabled {
			continue
		}
		if err := m.Connect(ctx, c); err != nil {
			log.Printf("MCP: connect %q failed: %v", c.Name, err)
		}
	}
	return nil
}

// Connect 建连一个 MCP Server 并注册其工具。
func (m *Manager) Connect(ctx context.Context, cfg *core.MCPConnection) error {
	m.mu.Lock()
	// 如果已连接，先断开
	if old, ok := m.conns[cfg.Name]; ok {
		m.mu.Unlock()
		m.disconnectLocked(old)
		m.mu.Lock()
	}
	m.mu.Unlock()

	cli, cancel, err := m.createClient(ctx, cfg)
	if err != nil {
		return fmt.Errorf("create client: %w", err)
	}

	// Initialize
	initReq := mcp.InitializeRequest{}
	initReq.Params.ClientInfo = mcp.Implementation{
		Name:    "orca",
		Version: "1.0.0",
	}
	initReq.Params.ProtocolVersion = mcp.LATEST_PROTOCOL_VERSION
	if _, err := cli.Initialize(ctx, initReq); err != nil {
		cancel()
		return fmt.Errorf("initialize: %w", err)
	}

	// 发现工具 via eino-ext
	einoTools, err := einomcp.GetTools(ctx, &einomcp.Config{Cli: cli})
	if err != nil {
		cancel()
		return fmt.Errorf("get tools: %w", err)
	}

	// 注册到 Registry（带前缀）
	prefix := cfg.Name
	registeredNames := make([]string, 0, len(einoTools))
	for _, et := range einoTools {
		invokable, ok := et.(tool.InvokableTool)
		if !ok {
			log.Printf("MCP: skip non-invokable tool from %s", prefix)
			continue
		}
		info, err := et.Info(ctx)
		if err != nil {
			log.Printf("MCP: skip tool from %s: %v", prefix, err)
			continue
		}
		prefixedName := prefix + "__" + info.Name
		inv := invokable // capture
		handler := func(hctx context.Context, args string) (string, error) {
			return inv.InvokableRun(hctx, args)
		}
		prefixedInfo := *info
		prefixedInfo.Name = prefixedName
		m.registry.Register(&prefixedInfo, handler)
		registeredNames = append(registeredNames, prefixedName)
	}

	conn := &Connection{
		Name:      cfg.Name,
		ConnID:    cfg.ID,
		Client:    cli,
		ToolNames: registeredNames,
		cancel:    cancel,
	}

	m.mu.Lock()
	m.conns[cfg.Name] = conn
	m.mu.Unlock()

	log.Printf("MCP: connected %q — %d tools: %v", cfg.Name, len(registeredNames), registeredNames)
	return nil
}

// createClient 根据 transport 类型创建 mcp-go client。
func (m *Manager) createClient(ctx context.Context, cfg *core.MCPConnection) (mcpclient.MCPClient, context.CancelFunc, error) {
	ctx, cancel := context.WithCancel(ctx)

	switch cfg.Transport {
	case "stdio":
		var args []string
		if len(cfg.Args) > 0 {
			_ = json.Unmarshal(cfg.Args, &args)
		}
		var envMap map[string]string
		if len(cfg.Env) > 0 {
			_ = json.Unmarshal(cfg.Env, &envMap)
		}
		env := make([]string, 0, len(envMap))
		for k, v := range envMap {
			env = append(env, k+"="+v)
		}
		cli, err := mcpclient.NewStdioMCPClient(cfg.Command, env, args...)
		if err != nil {
			cancel()
			return nil, nil, fmt.Errorf("stdio client: %w", err)
		}
		return cli, func() { cancel(); cli.Close() }, nil

	case "sse":
		oauthCfg := m.buildOAuthConfig(cfg)

		// 先尝试 Streamable HTTP（现代 MCP Server 优先），失败后回退 SSE。
		if cli, cleanup, err := m.tryStreamableHTTP(ctx, cancel, cfg, oauthCfg); err == nil {
			return cli, cleanup, nil
		} else {
			log.Printf("MCP %s: streamable HTTP failed (%v), trying SSE fallback", cfg.Name, err)
		}

		// SSE fallback
		var sseOpts []transport.ClientOption
		if oauthCfg != nil {
			sseOpts = append(sseOpts, transport.WithOAuth(*oauthCfg))
		} else if cfg.AuthType == "bearer" && cfg.AuthToken != "" {
			sseOpts = append(sseOpts, transport.WithHeaders(map[string]string{
				"Authorization": "Bearer " + cfg.AuthToken,
			}))
		}
		sseTransport, err := transport.NewSSE(cfg.URL, sseOpts...)
		if err != nil {
			cancel()
			return nil, nil, fmt.Errorf("sse transport: %w", err)
		}
		if err := sseTransport.Start(ctx); err != nil {
			cancel()
			return nil, nil, fmt.Errorf("sse start: %w", err)
		}
		cli := mcpclient.NewClient(sseTransport)
		return cli, func() { cancel(); cli.Close() }, nil

	default:
		cancel()
		return nil, nil, fmt.Errorf("unsupported transport: %s", cfg.Transport)
	}
}

// buildOAuthConfig 如果连接需要 OAuth，构建 OAuthConfig；否则返回 nil。
func (m *Manager) buildOAuthConfig(cfg *core.MCPConnection) *mcpclient.OAuthConfig {
	if cfg.AuthType != "oauth" {
		return nil
	}
	if len(cfg.OAuthToken) == 0 {
		return nil
	}
	tokenStore := NewDBTokenStore(m.db, cfg.ID)
	oauthCfg := mcpclient.OAuthConfig{
		ClientID:     cfg.OAuthClientID,
		ClientSecret: cfg.OAuthClientSecret,
		RedirectURI:  m.oauthRedirectURI(),
		TokenStore:   tokenStore,
		PKCEEnabled:  true,
	}
	if cfg.OAuthScopes != "" {
		oauthCfg.Scopes = strings.Split(cfg.OAuthScopes, " ")
	}
	return &oauthCfg
}

// tryStreamableHTTP 尝试用 Streamable HTTP transport 连接。
func (m *Manager) tryStreamableHTTP(ctx context.Context, cancel context.CancelFunc, cfg *core.MCPConnection, oauthCfg *mcpclient.OAuthConfig) (mcpclient.MCPClient, context.CancelFunc, error) {
	var httpOpts []transport.StreamableHTTPCOption
	if oauthCfg != nil {
		httpOpts = append(httpOpts, transport.WithHTTPOAuth(*oauthCfg))
	} else if cfg.AuthType == "bearer" && cfg.AuthToken != "" {
		httpOpts = append(httpOpts, transport.WithHTTPHeaders(map[string]string{
			"Authorization": "Bearer " + cfg.AuthToken,
		}))
	}
	httpTransport, err := transport.NewStreamableHTTP(cfg.URL, httpOpts...)
	if err != nil {
		return nil, nil, fmt.Errorf("create: %w", err)
	}
	if err := httpTransport.Start(ctx); err != nil {
		return nil, nil, fmt.Errorf("start: %w", err)
	}
	cli := mcpclient.NewClient(httpTransport)
	return cli, func() { cancel(); cli.Close() }, nil
}

func (m *Manager) oauthRedirectURI() string {
	if m.baseURL != "" {
		return m.baseURL + "/api/mcp/oauth/callback"
	}
	// fallback：从 settings 表读
	var cfg struct {
		BaseURL string `json:"base_url"`
	}
	if found, _ := db.LoadSetting(m.db, "site", &cfg); found && cfg.BaseURL != "" {
		return cfg.BaseURL + "/api/mcp/oauth/callback"
	}
	return "http://localhost:9000/api/mcp/oauth/callback"
}

// Disconnect 断开一个连接并反注册其工具。
func (m *Manager) Disconnect(name string) error {
	m.mu.Lock()
	conn, ok := m.conns[name]
	if !ok {
		m.mu.Unlock()
		return nil
	}
	delete(m.conns, name)
	m.mu.Unlock()
	m.disconnectLocked(conn)
	return nil
}

func (m *Manager) disconnectLocked(conn *Connection) {
	for _, name := range conn.ToolNames {
		m.registry.Unregister(name)
	}
	if conn.cancel != nil {
		conn.cancel()
	}
	log.Printf("MCP: disconnected %q — %d tools unregistered", conn.Name, len(conn.ToolNames))
}

// Reconnect 断开再重连。
func (m *Manager) Reconnect(ctx context.Context, cfg *core.MCPConnection) error {
	m.Disconnect(cfg.Name)
	return m.Connect(ctx, cfg)
}

// Status 返回所有连接的状态快照。
func (m *Manager) Status() []ConnectionStatus {
	m.mu.RLock()
	defer m.mu.RUnlock()

	out := make([]ConnectionStatus, 0, len(m.conns))
	for _, conn := range m.conns {
		out = append(out, ConnectionStatus{
			Name:      conn.Name,
			ConnID:    conn.ConnID,
			Status:    "connected",
			ToolNames: conn.ToolNames,
		})
	}
	return out
}

// IsConnected 检查连接是否活跃。
func (m *Manager) IsConnected(name string) bool {
	m.mu.RLock()
	defer m.mu.RUnlock()
	_, ok := m.conns[name]
	return ok
}

// GetConnectionTools 返回指定连接的工具名列表。
func (m *Manager) GetConnectionTools(name string) []string {
	m.mu.RLock()
	defer m.mu.RUnlock()
	if conn, ok := m.conns[name]; ok {
		return conn.ToolNames
	}
	return nil
}

// Close 关闭所有连接。
func (m *Manager) Close() {
	m.mu.Lock()
	conns := make([]*Connection, 0, len(m.conns))
	for _, c := range m.conns {
		conns = append(conns, c)
	}
	m.conns = make(map[string]*Connection)
	m.mu.Unlock()

	for _, c := range conns {
		m.disconnectLocked(c)
	}
}

// --- OAuth 流程辅助 ---

// StartOAuth 发起 OAuth 授权流程，返回授权 URL。
// 通过创建 SSE transport 并 Start() 来触发 OAuth 401 → OAuthAuthorizationRequiredError，
// 从中提取 OAuthHandler 来生成授权 URL。
func (m *Manager) StartOAuth(ctx context.Context, cfg *core.MCPConnection) (string, error) {
	tokenStore := NewDBTokenStore(m.db, cfg.ID)

	oauthCfg := mcpclient.OAuthConfig{
		ClientID:     cfg.OAuthClientID,
		ClientSecret: cfg.OAuthClientSecret,
		RedirectURI:  m.oauthRedirectURI(),
		TokenStore:   tokenStore,
		PKCEEnabled:  true,
	}
	if cfg.OAuthScopes != "" {
		oauthCfg.Scopes = strings.Split(cfg.OAuthScopes, " ")
	}

	// 创建 SSE transport 并尝试 Start — 如果 MCP Server 需要 OAuth，
	// Start() 会返回 OAuthAuthorizationRequiredError。
	sseTransport, err := transport.NewSSE(cfg.URL, transport.WithOAuth(oauthCfg))
	if err != nil {
		return "", fmt.Errorf("create sse transport: %w", err)
	}

	err = sseTransport.Start(ctx)
	if err != nil {
		var oauthErr *transport.OAuthAuthorizationRequiredError
		if errors.As(err, &oauthErr) && oauthErr.Handler != nil {
			return m.buildAuthURL(ctx, cfg, oauthErr.Handler, tokenStore)
		}
		return "", fmt.Errorf("start transport: %w", err)
	}

	// Start 成功说明 token 已有效，不需要授权
	sseTransport.Close()
	return "", nil
}

func (m *Manager) buildAuthURL(ctx context.Context, cfg *core.MCPConnection, handler *transport.OAuthHandler, tokenStore *DBTokenStore) (string, error) {
	// 如果没有 client_id，先做动态客户端注册
	if handler.GetClientID() == "" {
		if err := handler.RegisterClient(ctx, "Orca"); err != nil {
			return "", fmt.Errorf("dynamic client registration: %w", err)
		}
		// 注册成功后把 client_id 持久化回 DB，下次不用重新注册
		if cid := handler.GetClientID(); cid != "" {
			m.db.Model(&core.MCPConnection{}).Where("id = ?", cfg.ID).
				Update("o_auth_client_id", cid)
		}
		if cs := handler.GetClientSecret(); cs != "" {
			m.db.Model(&core.MCPConnection{}).Where("id = ?", cfg.ID).
				Update("o_auth_client_secret", cs)
		}
	}

	state, err := transport.GenerateState()
	if err != nil {
		return "", fmt.Errorf("generate state: %w", err)
	}
	codeVerifier, err := transport.GenerateCodeVerifier()
	if err != nil {
		return "", fmt.Errorf("generate code verifier: %w", err)
	}
	codeChallenge := transport.GenerateCodeChallenge(codeVerifier)

	authURL, err := handler.GetAuthorizationURL(ctx, state, codeChallenge)
	if err != nil {
		return "", fmt.Errorf("get authorization url: %w", err)
	}

	// 暂存 OAuth 状态，回调时用
	m.oauthMu.Lock()
	m.pendingOAuth[state] = &PendingOAuth{
		ConnID:       cfg.ID,
		ConnName:     cfg.Name,
		State:        state,
		CodeVerifier: codeVerifier,
		Handler: &OAuthHandlerRef{
			TokenStore: tokenStore,
		},
	}
	m.oauthMu.Unlock()

	return authURL, nil
}

// HandleOAuthCallback 处理 OAuth 回调，换 token 并建连。
func (m *Manager) HandleOAuthCallback(ctx context.Context, code, state string) (string, error) {
	m.oauthMu.Lock()
	pending, ok := m.pendingOAuth[state]
	if !ok {
		m.oauthMu.Unlock()
		return "", fmt.Errorf("unknown oauth state")
	}
	delete(m.pendingOAuth, state)
	m.oauthMu.Unlock()

	// 加载连接配置
	cfg, err := core.GetMCPConnection(m.db, pending.ConnID)
	if err != nil {
		return "", fmt.Errorf("get connection: %w", err)
	}

	// 用 OAuthHandler 换 token
	tokenStore := pending.Handler.TokenStore
	oauthCfg := mcpclient.OAuthConfig{
		ClientID:     cfg.OAuthClientID,
		ClientSecret: cfg.OAuthClientSecret,
		RedirectURI:  m.oauthRedirectURI(),
		TokenStore:   tokenStore,
		PKCEEnabled:  true,
	}
	if cfg.OAuthScopes != "" {
		oauthCfg.Scopes = strings.Split(cfg.OAuthScopes, " ")
	}

	handler := transport.NewOAuthHandler(oauthCfg)
	handler.SetBaseURL(cfg.URL)
	handler.SetExpectedState(state)

	if err := handler.ProcessAuthorizationResponse(ctx, code, state, pending.CodeVerifier); err != nil {
		return "", fmt.Errorf("exchange token: %w", err)
	}

	// token 已通过 TokenStore 持久化到 DB
	// 尝试建连
	if err := m.Connect(ctx, cfg); err != nil {
		return pending.ConnName, fmt.Errorf("connect after oauth: %w", err)
	}

	return pending.ConnName, nil
}
