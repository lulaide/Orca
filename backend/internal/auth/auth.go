// Package auth 提供 JWT 认证和密码管理。
package auth

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"

	"github.com/lulaide/orca/internal/db"
)

// Claims 是 JWT 的 payload。
type Claims struct {
	UserID string `json:"sub"`
	Role   string `json:"role"`
	jwt.RegisteredClaims
}

const tokenExpiry = 7 * 24 * time.Hour

// HashPassword 用 bcrypt 散列密码。
func HashPassword(plain string) (string, error) {
	b, err := bcrypt.GenerateFromPassword([]byte(plain), bcrypt.DefaultCost)
	return string(b), err
}

// CheckPassword 校验密码。
func CheckPassword(hash, plain string) bool {
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(plain)) == nil
}

// GenerateToken 生成 JWT。
func GenerateToken(userID, role, secret string) (string, error) {
	claims := Claims{
		UserID: userID,
		Role:   role,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(tokenExpiry)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString([]byte(secret))
}

// ParseToken 解析并校验 JWT。
func ParseToken(tokenStr, secret string) (*Claims, error) {
	token, err := jwt.ParseWithClaims(tokenStr, &Claims{}, func(t *jwt.Token) (any, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, errors.New("unexpected signing method")
		}
		return []byte(secret), nil
	})
	if err != nil {
		return nil, err
	}
	claims, ok := token.Claims.(*Claims)
	if !ok || !token.Valid {
		return nil, errors.New("invalid token")
	}
	return claims, nil
}

// GetOrCreateJWTSecret 从 settings 表读取 JWT 签名密钥，不存在则生成。
func GetOrCreateJWTSecret(gormDB *gorm.DB) (string, error) {
	var cfg struct {
		Secret string `json:"secret"`
	}
	found, err := db.LoadSetting(gormDB, "auth_jwt_secret", &cfg)
	if err != nil {
		return "", err
	}
	if found && cfg.Secret != "" {
		return cfg.Secret, nil
	}
	// 生成随机 256-bit key
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	cfg.Secret = hex.EncodeToString(b)
	if err := db.SaveSetting(gormDB, "auth_jwt_secret", cfg, "system"); err != nil {
		return "", err
	}
	return cfg.Secret, nil
}
