package auth

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"sync"

	"github.com/coreos/go-oidc/v3/oidc"
	"golang.org/x/oauth2"
	"gorm.io/gorm"

	"github.com/lulaide/orca/internal/db"
)

// OAuthProviderConfig 是 SSO 提供商的配置，存在 settings 表 key="auth_oauth"。
type OAuthProviderConfig struct {
	Enabled      bool   `json:"enabled"`
	ProviderName string `json:"provider_name"` // 显示名，如 "Authentik"
	IssuerURL    string `json:"issuer_url"`    // OIDC 自动发现（优先）
	AuthURL      string `json:"auth_url"`      // 手动：授权端点
	TokenURL     string `json:"token_url"`     // 手动：令牌端点
	UserInfoURL  string `json:"userinfo_url"`  // 手动：用户信息端点
	ClientID     string `json:"client_id"`
	ClientSecret string `json:"client_secret"`
	Scopes       string `json:"scopes"`       // 空格分隔，默认 "openid profile email"
	DefaultRole  string `json:"default_role"` // "member" | "admin"
}

// OAuthUserInfo 是从 SSO 用户信息端点获取的用户资料。
type OAuthUserInfo struct {
	Sub      string `json:"sub"`
	Email    string `json:"email"`
	Name     string `json:"name"`
	Username string `json:"preferred_username"`
	Picture  string `json:"picture"`
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
		var info OAuthUserInfo
		if err := userInfo.Claims(&info); err != nil {
			return nil, err
		}
		info.Sub = userInfo.Subject
		if info.Email == "" {
			info.Email = userInfo.Email
		}
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
	var info OAuthUserInfo
	if err := json.NewDecoder(resp.Body).Decode(&info); err != nil {
		return nil, err
	}
	return &info, nil
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
