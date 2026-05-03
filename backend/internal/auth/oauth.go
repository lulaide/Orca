package auth

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"strings"
	"fmt"
	"sync"

	"github.com/coreos/go-oidc/v3/oidc"
	"golang.org/x/oauth2"
	"gorm.io/gorm"

	"github.com/lulaide/orca/internal/db"
)

// OAuthProviderConfig 是 SSO 提供商的配置，存在 settings 表 key="auth_oauth"。
type OAuthProviderConfig struct {
	Enabled       bool   `json:"enabled"`
	ProviderName  string `json:"provider_name"`  // 显示名，如 "Authentik"
	IssuerURL     string `json:"issuer_url"`     // OIDC 自动发现（优先）
	AuthURL       string `json:"auth_url"`       // 手动：授权端点
	TokenURL      string `json:"token_url"`      // 手动：令牌端点
	UserInfoURL   string `json:"userinfo_url"`   // 手动：用户信息端点
	ClientID      string `json:"client_id"`
	ClientSecret  string `json:"client_secret"`
	Scopes        string `json:"scopes"`         // 空格分隔，默认 "openid profile email"
	GroupsClaim   string `json:"groups_claim"`   // groups claim 名称，默认 "groups"
	AllowedGroups string `json:"allowed_groups"` // 允许登录的组（逗号分隔），留空不限制
}

// OAuthUserInfo 是从 SSO 用户信息端点获取的用户资料。
type OAuthUserInfo struct {
	Sub      string   `json:"sub"`
	Email    string   `json:"email"`
	Name     string   `json:"name"`
	Username string   `json:"preferred_username"`
	Picture  string   `json:"picture"`
	Groups   []string `json:"groups"`
}

// IsInAllowedGroups 检查用户是否在允许的组里。allowedGroups 为空表示不限制。
func (u *OAuthUserInfo) IsInAllowedGroups(allowedGroups string) bool {
	if allowedGroups == "" {
		return true
	}
	allowed := make(map[string]bool)
	for _, g := range strings.Split(allowedGroups, ",") {
		g = strings.TrimSpace(g)
		if g != "" {
			allowed[g] = true
		}
	}
	if len(allowed) == 0 {
		return true
	}
	for _, g := range u.Groups {
		// 支持完整路径匹配和名称匹配（如 "/运维部" 和 "运维部" 都行）
		name := strings.TrimPrefix(g, "/")
		if allowed[g] || allowed[name] {
			return true
		}
	}
	return false
}

// PendingOAuthLogin 暂存 OAuth 登录流程中间状态。
type PendingOAuthLogin struct {
	State        string
	CodeVerifier string
}

// OAuthManager 管理 SSO 登录流程。
type OAuthManager struct {
	mu      sync.Mutex
	pending map[string]*PendingOAuthLogin // state → pending
	gormDB  *gorm.DB
}

// NewOAuthManager 创建 OAuth 管理器。
func NewOAuthManager(gormDB *gorm.DB) *OAuthManager {
	return &OAuthManager{
		pending: make(map[string]*PendingOAuthLogin),
		gormDB:  gormDB,
	}
}

// LoadConfig 从 settings 表加载 OAuth 配置。
func LoadOAuthConfig(gormDB *gorm.DB) (*OAuthProviderConfig, error) {
	var cfg OAuthProviderConfig
	found, err := db.LoadSetting(gormDB, "auth_oauth", &cfg)
	if err != nil {
		return nil, err
	}
	if !found {
		return nil, nil
	}
	return &cfg, nil
}

// SaveConfig 保存 OAuth 配置到 settings 表。
func SaveOAuthConfig(gormDB *gorm.DB, cfg *OAuthProviderConfig) error {
	return db.SaveSetting(gormDB, "auth_oauth", cfg, "admin")
}

// GetAuthorizationURL 生成 SSO 授权跳转 URL。
func (m *OAuthManager) GetAuthorizationURL(ctx context.Context, cfg *OAuthProviderConfig, redirectURI string) (string, error) {
	oauth2Cfg, err := m.buildOAuth2Config(ctx, cfg, redirectURI)
	if err != nil {
		return "", err
	}

	// 生成 state + PKCE
	state, err := randomHex(16)
	if err != nil {
		return "", fmt.Errorf("generate state: %w", err)
	}
	verifier := oauth2.GenerateVerifier()

	m.mu.Lock()
	m.pending[state] = &PendingOAuthLogin{
		State:        state,
		CodeVerifier: verifier,
	}
	m.mu.Unlock()

	url := oauth2Cfg.AuthCodeURL(state,
		oauth2.S256ChallengeOption(verifier),
	)
	return url, nil
}

// ExchangeCode 用授权码换取用户信息。
func (m *OAuthManager) ExchangeCode(ctx context.Context, cfg *OAuthProviderConfig, redirectURI, code, state string) (*OAuthUserInfo, error) {
	m.mu.Lock()
	pending, ok := m.pending[state]
	if !ok {
		m.mu.Unlock()
		return nil, errors.New("invalid state")
	}
	delete(m.pending, state)
	m.mu.Unlock()

	oauth2Cfg, err := m.buildOAuth2Config(ctx, cfg, redirectURI)
	if err != nil {
		return nil, err
	}

	token, err := oauth2Cfg.Exchange(ctx, code, oauth2.VerifierOption(pending.CodeVerifier))
	if err != nil {
		return nil, fmt.Errorf("exchange code: %w", err)
	}

	// 获取用户信息
	userInfo, err := m.fetchUserInfo(ctx, cfg, token)
	if err != nil {
		return nil, fmt.Errorf("fetch userinfo: %w", err)
	}

	return userInfo, nil
}

func (m *OAuthManager) buildOAuth2Config(ctx context.Context, cfg *OAuthProviderConfig, redirectURI string) (*oauth2.Config, error) {
	scopes := []string{"openid", "profile", "email"}
	if cfg.Scopes != "" {
		scopes = splitScopes(cfg.Scopes)
	}

	// OIDC 自动发现
	if cfg.IssuerURL != "" {
		provider, err := oidc.NewProvider(ctx, cfg.IssuerURL)
		if err != nil {
			return nil, fmt.Errorf("oidc discovery: %w", err)
		}
		return &oauth2.Config{
			ClientID:     cfg.ClientID,
			ClientSecret: cfg.ClientSecret,
			RedirectURL:  redirectURI,
			Endpoint:     provider.Endpoint(),
			Scopes:       scopes,
		}, nil
	}

	// 手动端点
	if cfg.AuthURL == "" || cfg.TokenURL == "" {
		return nil, errors.New("需要填写 issuer_url 或 auth_url + token_url")
	}
	return &oauth2.Config{
		ClientID:     cfg.ClientID,
		ClientSecret: cfg.ClientSecret,
		RedirectURL:  redirectURI,
		Endpoint: oauth2.Endpoint{
			AuthURL:  cfg.AuthURL,
			TokenURL: cfg.TokenURL,
		},
		Scopes: scopes,
	}, nil
}

func (m *OAuthManager) fetchUserInfo(ctx context.Context, cfg *OAuthProviderConfig, token *oauth2.Token) (*OAuthUserInfo, error) {
	groupsClaim := cfg.GroupsClaim
	if groupsClaim == "" {
		groupsClaim = "groups"
	}

	// 优先用 OIDC provider 的 UserInfo 端点
	if cfg.IssuerURL != "" {
		provider, err := oidc.NewProvider(ctx, cfg.IssuerURL)
		if err != nil {
			return nil, err
		}
		userInfo, err := provider.UserInfo(ctx, oauth2.StaticTokenSource(token))
		if err != nil {
			return nil, err
		}
		// 先解析到 raw map 以提取自定义 groups claim
		var raw map[string]any
		if err := userInfo.Claims(&raw); err != nil {
			return nil, err
		}
		var info OAuthUserInfo
		if err := userInfo.Claims(&info); err != nil {
			return nil, err
		}
		info.Sub = userInfo.Subject
		if info.Email == "" {
			info.Email = userInfo.Email
		}
		info.Groups = extractGroups(raw, groupsClaim)
		return &info, nil
	}

	// 手动 userinfo 端点
	if cfg.UserInfoURL == "" {
		return nil, errors.New("缺少 userinfo 端点")
	}
	client := oauth2.NewClient(ctx, oauth2.StaticTokenSource(token))
	resp, err := client.Get(cfg.UserInfoURL)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	var raw map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&raw); err != nil {
		return nil, err
	}
	b, _ := json.Marshal(raw)
	var info OAuthUserInfo
	json.Unmarshal(b, &info)
	info.Groups = extractGroups(raw, groupsClaim)
	return &info, nil
}

// extractGroups 从 userinfo 原始 claims 里提取 groups。
func extractGroups(claims map[string]any, claimName string) []string {
	val, ok := claims[claimName]
	if !ok {
		return nil
	}
	switch v := val.(type) {
	case []any:
		groups := make([]string, 0, len(v))
		for _, g := range v {
			if s, ok := g.(string); ok {
				groups = append(groups, s)
			}
		}
		return groups
	case []string:
		return v
	default:
		return nil
	}
}

func splitScopes(s string) []string {
	var out []string
	for _, p := range splitWhitespace(s) {
		if p != "" {
			out = append(out, p)
		}
	}
	return out
}

func splitWhitespace(s string) []string {
	var result []string
	current := ""
	for _, c := range s {
		if c == ' ' || c == '\t' {
			if current != "" {
				result = append(result, current)
				current = ""
			}
		} else {
			current += string(c)
		}
	}
	if current != "" {
		result = append(result, current)
	}
	return result
}

func randomHex(n int) (string, error) {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}
