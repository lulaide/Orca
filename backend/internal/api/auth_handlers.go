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
	if err := d.DB.First(&user, "username = ?", req.Username).Error; err != nil {
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
