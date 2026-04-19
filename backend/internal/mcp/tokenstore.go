package mcp

import (
	"context"
	"encoding/json"
	"errors"

	mcpclient "github.com/mark3labs/mcp-go/client"
	"github.com/mark3labs/mcp-go/client/transport"
	"gorm.io/gorm"

	"github.com/lulaide/orca/internal/core"
)

// DBTokenStore 实现 transport.TokenStore，把 OAuth token 持久化到
// mcp_connections.oauth_token JSONB 字段。
type DBTokenStore struct {
	db     *gorm.DB
	connID string
}

var _ mcpclient.TokenStore = (*DBTokenStore)(nil)

// NewDBTokenStore 创建一个绑定到特定连接的 token store。
func NewDBTokenStore(db *gorm.DB, connID string) *DBTokenStore {
	return &DBTokenStore{db: db, connID: connID}
}

// GetToken 从 DB 读取 token。
func (s *DBTokenStore) GetToken(ctx context.Context) (*mcpclient.Token, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	conn, err := core.GetMCPConnection(s.db, s.connID)
	if err != nil {
		return nil, err
	}
	if len(conn.OAuthToken) == 0 {
		return nil, transport.ErrNoToken
	}
	var token mcpclient.Token
	if err := json.Unmarshal(conn.OAuthToken, &token); err != nil {
		return nil, err
	}
	if token.AccessToken == "" {
		return nil, transport.ErrNoToken
	}
	return &token, nil
}

// SaveToken 把 token 存入 DB。
func (s *DBTokenStore) SaveToken(ctx context.Context, token *mcpclient.Token) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	b, err := json.Marshal(token)
	if err != nil {
		return err
	}
	return core.SaveMCPOAuthToken(s.db, s.connID, b)
}

// HasToken 检查是否有已存储的 token（不验证是否过期）。
func (s *DBTokenStore) HasToken(ctx context.Context) bool {
	t, err := s.GetToken(ctx)
	return err == nil && t != nil
}

// ensure transport.ErrNoToken is used
var _ = errors.Is
