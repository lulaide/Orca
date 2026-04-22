package api

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"github.com/lulaide/orca/internal/auth"
	"github.com/lulaide/orca/internal/core"
)

// handleAuthStatus 返回系统认证状态：是否已初始化（有用户）、当前登录用户。
func (d *Deps) handleAuthStatus(c *gin.Context) {
	var count int64
	d.DB.Model(&core.User{}).Count(&count)
	initialized := count > 0

	resp := gin.H{"initialized": initialized}

	// OAuth 状态
	oauthCfg, _ := auth.LoadOAuthConfig(d.DB)
	if oauthCfg != nil && oauthCfg.Enabled {
		resp["oauth_enabled"] = true
		resp["oauth_provider_name"] = oauthCfg.ProviderName
	} else {
		resp["oauth_enabled"] = false
	}

	// 如果带了有效 token，也返回当前用户信息
	header := c.GetHeader("Authorization")
	if header != "" && len(header) > 7 {
		token := header[7:] // "Bearer "
		claims, err := auth.ParseToken(token, d.JWTSecret)
		if err == nil {
			var user core.User
			if d.DB.First(&user, "id = ?", claims.UserID).Error == nil {
				resp["user"] = gin.H{
					"id":       user.ID,
					"username": user.Username,
					"role":     user.Role,
				}
			}
		}
	}

	c.JSON(http.StatusOK, resp)
}

// handleAuthSetup 创建第一个管理员用户。仅在无用户时可用。
func (d *Deps) handleAuthSetup(c *gin.Context) {
	var count int64
	d.DB.Model(&core.User{}).Count(&count)
	if count > 0 {
		c.JSON(http.StatusConflict, gin.H{"error": "管理员已存在"})
		return
	}

	var req struct {
		Username string `json:"username" binding:"required"`
		Password string `json:"password" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if len(req.Password) < 6 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "密码至少 6 位"})
		return
	}

	hash, err := auth.HashPassword(req.Password)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "密码加密失败"})
		return
	}

	user := core.User{
		ID:           uuid.NewString(),
		Username:     req.Username,
		PasswordHash: hash,
		Role:         "admin",
		Provider:     "local",
	}
	if err := d.DB.Create(&user).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "创建用户失败: " + err.Error()})
		return
	}

	token, err := auth.GenerateToken(user.ID, user.Role, d.JWTSecret)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "生成令牌失败"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"token": token,
		"user": gin.H{
			"id":       user.ID,
			"username": user.Username,
			"role":     user.Role,
		},
	})
}

// handleAuthLogin 用户名密码登录。
func (d *Deps) handleAuthLogin(c *gin.Context) {
	var req struct {
		Username string `json:"username" binding:"required"`
		Password string `json:"password" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var user core.User
	if err := d.DB.First(&user, "username = ? AND provider = ?", req.Username, "local").Error; err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "用户名或密码错误"})
		return
	}

	if !auth.CheckPassword(user.PasswordHash, req.Password) {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "用户名或密码错误"})
		return
	}

	token, err := auth.GenerateToken(user.ID, user.Role, d.JWTSecret)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "生成令牌失败"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"token": token,
		"user": gin.H{
			"id":       user.ID,
			"username": user.Username,
			"role":     user.Role,
		},
	})
}

// ---- OAuth/OIDC SSO ----

func (d *Deps) handleOAuthAuthorize(c *gin.Context) {
	cfg, err := auth.LoadOAuthConfig(d.DB)
	if err != nil || cfg == nil || !cfg.Enabled {
		c.JSON(http.StatusBadRequest, gin.H{"error": "SSO 未配置"})
		return
	}
	url, err := d.OAuth.GetAuthorizationURL(c.Request.Context(), cfg, d.oauthRedirectURI(c))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.Redirect(http.StatusFound, url)
}

func (d *Deps) handleOAuthCallback(c *gin.Context) {
	code, state := c.Query("code"), c.Query("state")
	if code == "" || state == "" {
		c.Data(400, "text/html; charset=utf-8", []byte(`<h2>登录失败</h2><p>缺少参数</p>`))
		return
	}
	cfg, err := auth.LoadOAuthConfig(d.DB)
	if err != nil || cfg == nil || !cfg.Enabled {
		c.Data(400, "text/html; charset=utf-8", []byte(`<h2>登录失败</h2><p>SSO 未配置</p>`))
		return
	}
	userInfo, err := d.OAuth.ExchangeCode(c.Request.Context(), cfg, d.oauthRedirectURI(c), code, state)
	if err != nil {
		c.Data(200, "text/html; charset=utf-8", []byte(`<h2>登录失败</h2><p>`+err.Error()+`</p>`))
		return
	}
	providerName := cfg.ProviderName
	if providerName == "" { providerName = "oidc" }

	var user core.User
	if d.DB.First(&user, "provider = ? AND provider_id = ?", providerName, userInfo.Sub).Error != nil {
		username := userInfo.Username
		if username == "" { username = userInfo.Email }
		if username == "" { username = userInfo.Sub }
		var dup core.User
		if d.DB.First(&dup, "username = ?", username).Error == nil {
			username = username + "_" + userInfo.Sub[:8]
		}
		role := cfg.DefaultRole
		if role == "" { role = "member" }
		user = core.User{
			ID: uuid.NewString(), Username: username, Role: role,
			Provider: providerName, ProviderID: userInfo.Sub,
			Email: userInfo.Email, Avatar: userInfo.Picture,
		}
		d.DB.Create(&user)
	} else {
		up := map[string]any{}
		if userInfo.Email != "" { up["email"] = userInfo.Email }
		if userInfo.Picture != "" { up["avatar"] = userInfo.Picture }
		if len(up) > 0 { d.DB.Model(&user).Updates(up) }
	}

	jwtToken, _ := auth.GenerateToken(user.ID, user.Role, d.JWTSecret)
	c.Data(200, "text/html; charset=utf-8", []byte(`<!DOCTYPE html><html><body>
<script>
if(window.opener){window.opener.postMessage({type:'orca-sso-done',token:'`+jwtToken+`'},'*');setTimeout(()=>window.close(),500)}
else{localStorage.setItem('orca_token','`+jwtToken+`');location.href='/'}
</script></body></html>`))
}

func (d *Deps) handleGetOAuthConfig(c *gin.Context) {
	cfg, _ := auth.LoadOAuthConfig(d.DB)
	if cfg == nil { c.JSON(200, gin.H{"enabled": false}); return }
	c.JSON(200, gin.H{
		"enabled": cfg.Enabled, "provider_name": cfg.ProviderName,
		"issuer_url": cfg.IssuerURL, "client_id": cfg.ClientID,
		"scopes": cfg.Scopes, "default_role": cfg.DefaultRole,
	})
}

func (d *Deps) handleSetOAuthConfig(c *gin.Context) {
	var cfg auth.OAuthProviderConfig
	if err := c.ShouldBindJSON(&cfg); err != nil {
		c.JSON(400, gin.H{"error": err.Error()}); return
	}
	if err := auth.SaveOAuthConfig(d.DB, &cfg); err != nil {
		c.JSON(500, gin.H{"error": err.Error()}); return
	}
	c.JSON(200, gin.H{"saved": true})
}

func (d *Deps) oauthRedirectURI(c *gin.Context) string {
	scheme := "http"
	if c.Request.TLS != nil || c.GetHeader("X-Forwarded-Proto") == "https" { scheme = "https" }
	return scheme + "://" + c.Request.Host + "/api/auth/oauth/callback"
}
