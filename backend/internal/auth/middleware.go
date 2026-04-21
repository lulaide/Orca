package auth

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
)

type contextKey string

const (
	UserIDKey contextKey = "auth_user_id"
	RoleKey   contextKey = "auth_role"
)

// RequireAuth 返回 Gin 中间件，校验 JWT 并注入用户信息到 context。
func RequireAuth(jwtSecret string) gin.HandlerFunc {
	return func(c *gin.Context) {
		header := c.GetHeader("Authorization")
		if header == "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "未登录"})
			return
		}
		token := strings.TrimPrefix(header, "Bearer ")
		if token == header {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "无效的 Authorization 头"})
			return
		}

		claims, err := ParseToken(token, jwtSecret)
		if err != nil {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "令牌无效或已过期"})
			return
		}

		c.Set(string(UserIDKey), claims.UserID)
		c.Set(string(RoleKey), claims.Role)
		c.Next()
	}
}

// GetUserID 从 gin.Context 取当前用户 ID。
func GetUserID(c *gin.Context) string {
	v, _ := c.Get(string(UserIDKey))
	s, _ := v.(string)
	return s
}

// GetRole 从 gin.Context 取当前用户角色。
func GetRole(c *gin.Context) string {
	v, _ := c.Get(string(RoleKey))
	s, _ := v.(string)
	return s
}
