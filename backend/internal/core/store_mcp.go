package core

import (
	"encoding/json"
	"errors"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// CreateMCPConnectionInput 建 MCPConnection 入参。
type CreateMCPConnectionInput struct {
	Name              string   `json:"name"`
	Transport         string   `json:"transport"` // "stdio" | "sse"
	Command           string   `json:"command,omitempty"`
	Args              []string `json:"args,omitempty"`
	Env               map[string]string `json:"env,omitempty"`
	URL               string   `json:"url,omitempty"`
	AuthType          string   `json:"auth_type,omitempty"`
	AuthToken         string   `json:"auth_token,omitempty"`
	OAuthClientID     string   `json:"oauth_client_id,omitempty"`
	OAuthClientSecret string   `json:"oauth_client_secret,omitempty"`
	OAuthScopes       string   `json:"oauth_scopes,omitempty"`
	Description       string   `json:"description,omitempty"`
}

var validTransports = map[string]bool{"stdio": true, "sse": true}
var validAuthTypes = map[string]bool{"none": true, "bearer": true, "oauth": true, "": true}

// CreateMCPConnection 创建一条 MCP 连接配置。
func CreateMCPConnection(db *gorm.DB, in CreateMCPConnectionInput) (*MCPConnection, error) {
	if in.Name == "" {
		return nil, errors.New("name is required")
	}
	if !validTransports[in.Transport] {
		return nil, errors.New("transport must be stdio or sse")
	}
	if in.Transport == "stdio" && in.Command == "" {
		return nil, errors.New("command is required for stdio transport")
	}
	if in.Transport == "sse" && in.URL == "" {
		return nil, errors.New("url is required for sse transport")
	}
	if !validAuthTypes[in.AuthType] {
		return nil, errors.New("invalid auth_type")
	}

	conn := &MCPConnection{
		ID:                uuid.NewString(),
		Name:              in.Name,
		Transport:         in.Transport,
		Command:           in.Command,
		URL:               in.URL,
		AuthType:          in.AuthType,
		AuthToken:         in.AuthToken,
		OAuthClientID:     in.OAuthClientID,
		OAuthClientSecret: in.OAuthClientSecret,
		OAuthScopes:       in.OAuthScopes,
		Description:       in.Description,
		Enabled:           true,
	}

	if len(in.Args) > 0 {
		conn.Args = mustJSON(in.Args)
	}
	if len(in.Env) > 0 {
		conn.Env = mustJSON(in.Env)
	}

	if err := db.Create(conn).Error; err != nil {
		return nil, err
	}
	return conn, nil
}

// GetMCPConnection 按 ID 查。
func GetMCPConnection(db *gorm.DB, id string) (*MCPConnection, error) {
	var conn MCPConnection
	if err := db.First(&conn, "id = ?", id).Error; err != nil {
		return nil, err
	}
	return &conn, nil
}

// ListMCPConnections 列出所有连接，按 name 排序。
func ListMCPConnections(db *gorm.DB) ([]MCPConnection, error) {
	var out []MCPConnection
	if err := db.Order("name ASC").Find(&out).Error; err != nil {
		return nil, err
	}
	return out, nil
}

// UpdateMCPConnectionPatch 可选更新字段。
type UpdateMCPConnectionPatch struct {
	Name              *string `json:"name,omitempty"`
	Transport         *string `json:"transport,omitempty"`
	Command           *string `json:"command,omitempty"`
	URL               *string `json:"url,omitempty"`
	AuthType          *string `json:"auth_type,omitempty"`
	AuthToken         *string `json:"auth_token,omitempty"`
	OAuthClientID     *string `json:"oauth_client_id,omitempty"`
	OAuthClientSecret *string `json:"oauth_client_secret,omitempty"`
	OAuthScopes       *string `json:"oauth_scopes,omitempty"`
	Description       *string `json:"description,omitempty"`
	Enabled           *bool   `json:"enabled,omitempty"`
}

// UpdateMCPConnection 按 ID 更新。
func UpdateMCPConnection(db *gorm.DB, id string, patch UpdateMCPConnectionPatch) (*MCPConnection, error) {
	conn, err := GetMCPConnection(db, id)
	if err != nil {
		return nil, err
	}

	updates := map[string]any{}
	if patch.Name != nil {
		updates["name"] = *patch.Name
	}
	if patch.Transport != nil {
		if !validTransports[*patch.Transport] {
			return nil, errors.New("transport must be stdio or sse")
		}
		updates["transport"] = *patch.Transport
	}
	if patch.Command != nil {
		updates["command"] = *patch.Command
	}
	if patch.URL != nil {
		updates["url"] = *patch.URL
	}
	if patch.AuthType != nil {
		if !validAuthTypes[*patch.AuthType] {
			return nil, errors.New("invalid auth_type")
		}
		updates["auth_type"] = *patch.AuthType
	}
	if patch.AuthToken != nil {
		updates["auth_token"] = *patch.AuthToken
	}
	if patch.OAuthClientID != nil {
		updates["oauth_client_id"] = *patch.OAuthClientID
	}
	if patch.OAuthClientSecret != nil {
		updates["oauth_client_secret"] = *patch.OAuthClientSecret
	}
	if patch.OAuthScopes != nil {
		updates["oauth_scopes"] = *patch.OAuthScopes
	}
	if patch.Description != nil {
		updates["description"] = *patch.Description
	}
	if patch.Enabled != nil {
		updates["enabled"] = *patch.Enabled
	}

	if len(updates) > 0 {
		if err := db.Model(conn).Updates(updates).Error; err != nil {
			return nil, err
		}
	}
	return GetMCPConnection(db, id)
}

// DeleteMCPConnection 按 ID 删除。
func DeleteMCPConnection(db *gorm.DB, id string) error {
	return db.Delete(&MCPConnection{}, "id = ?", id).Error
}

// SaveMCPOAuthToken 持久化 OAuth token 到连接记录。
func SaveMCPOAuthToken(db *gorm.DB, id string, tokenJSON []byte) error {
	return db.Model(&MCPConnection{}).Where("id = ?", id).
		Update("o_auth_token", tokenJSON).Error
}

// mustJSON 把任意值序列化成 datatypes.JSON。
func mustJSON(v any) []byte {
	b, _ := json.Marshal(v)
	return b
}
