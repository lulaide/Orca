package api

import (
	"context"
	"net/http"
	"net/url"

	"github.com/gin-gonic/gin"

	"github.com/lulaide/orca/internal/core"
)

// handleListMCPConnections 列出所有 MCP 连接 + 运行状态。
func (d *Deps) handleListMCPConnections(c *gin.Context) {
	conns, err := core.ListMCPConnections(d.DB)
	if err != nil {
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}

	statusMap := map[string]string{}
	toolsMap := map[string][]string{}
	for _, s := range d.MCP.Status() {
		statusMap[s.ConnID] = s.Status
		toolsMap[s.ConnID] = s.ToolNames
	}

	type connInfo struct {
		core.MCPConnection
		Status string   `json:"status"`
		Tools  []string `json:"tools"`
	}

	out := make([]connInfo, 0, len(conns))
	for _, conn := range conns {
		st := "disconnected"
		if !conn.Enabled {
			st = "disabled"
		} else if s, ok := statusMap[conn.ID]; ok {
			st = s
		} else if conn.AuthType == "oauth" && len(conn.OAuthToken) == 0 {
			st = "needs_auth"
		}
		tools := toolsMap[conn.ID]
		if tools == nil {
			tools = []string{}
		}
		// 不泄露敏感字段
		conn.AuthToken = ""
		conn.OAuthClientSecret = ""
		conn.OAuthToken = nil
		out = append(out, connInfo{
			MCPConnection: conn,
			Status:        st,
			Tools:         tools,
		})
	}
	c.JSON(200, out)
}

// handleCreateMCPConnection 创建新 MCP 连接。
func (d *Deps) handleCreateMCPConnection(c *gin.Context) {
	var req core.CreateMCPConnectionInput
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(400, gin.H{"error": err.Error()})
		return
	}
	conn, err := core.CreateMCPConnection(d.DB, req)
	if err != nil {
		c.JSON(400, gin.H{"error": err.Error()})
		return
	}

	// 非 OAuth 连接尝试自动建连
	if conn.AuthType != "oauth" {
		if err := d.MCP.Connect(context.Background(), conn); err != nil {
			// 建连失败不影响创建，返回 warning
			c.JSON(201, gin.H{
				"connection":      conn,
				"connect_warning": err.Error(),
			})
			return
		}
	}
	c.JSON(201, conn)
}

// handleGetMCPConnection 获取单个连接详情。
func (d *Deps) handleGetMCPConnection(c *gin.Context) {
	conn, err := core.GetMCPConnection(d.DB, c.Param("id"))
	if err != nil {
		c.JSON(404, gin.H{"error": "not found"})
		return
	}
	conn.AuthToken = ""
	conn.OAuthClientSecret = ""
	conn.OAuthToken = nil

	tools := d.MCP.GetConnectionTools(conn.Name)
	if tools == nil {
		tools = []string{}
	}
	st := "disconnected"
	if !conn.Enabled {
		st = "disabled"
	} else if d.MCP.IsConnected(conn.Name) {
		st = "connected"
	} else if conn.AuthType == "oauth" {
		st = "needs_auth"
	}
	c.JSON(200, gin.H{
		"connection": conn,
		"status":     st,
		"tools":      tools,
	})
}

// handleUpdateMCPConnection 更新连接配置。
func (d *Deps) handleUpdateMCPConnection(c *gin.Context) {
	var patch core.UpdateMCPConnectionPatch
	if err := c.ShouldBindJSON(&patch); err != nil {
		c.JSON(400, gin.H{"error": err.Error()})
		return
	}
	conn, err := core.UpdateMCPConnection(d.DB, c.Param("id"), patch)
	if err != nil {
		c.JSON(400, gin.H{"error": err.Error()})
		return
	}

	// 如果 enabled 变化，触发连接/断开
	if patch.Enabled != nil {
		if *patch.Enabled {
			_ = d.MCP.Connect(context.Background(), conn)
		} else {
			_ = d.MCP.Disconnect(conn.Name)
		}
	} else if conn.Enabled {
		// 配置变了就重连
		_ = d.MCP.Reconnect(context.Background(), conn)
	}
	c.JSON(200, conn)
}

// handleDeleteMCPConnection 删除连接。
func (d *Deps) handleDeleteMCPConnection(c *gin.Context) {
	conn, err := core.GetMCPConnection(d.DB, c.Param("id"))
	if err != nil {
		c.JSON(404, gin.H{"error": "not found"})
		return
	}
	_ = d.MCP.Disconnect(conn.Name)
	if err := core.DeleteMCPConnection(d.DB, c.Param("id")); err != nil {
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}
	c.JSON(200, gin.H{"deleted": true})
}

// handleReconnectMCPConnection 手动重连。
func (d *Deps) handleReconnectMCPConnection(c *gin.Context) {
	conn, err := core.GetMCPConnection(d.DB, c.Param("id"))
	if err != nil {
		c.JSON(404, gin.H{"error": "not found"})
		return
	}
	if err := d.MCP.Reconnect(context.Background(), conn); err != nil {
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}
	c.JSON(200, gin.H{"reconnected": true, "tools": d.MCP.GetConnectionTools(conn.Name)})
}

// handleMCPOAuthAuthorize 发起 OAuth 授权流程。
func (d *Deps) handleMCPOAuthAuthorize(c *gin.Context) {
	conn, err := core.GetMCPConnection(d.DB, c.Param("id"))
	if err != nil {
		c.JSON(404, gin.H{"error": "not found"})
		return
	}
	if conn.AuthType != "oauth" {
		c.JSON(400, gin.H{"error": "connection does not use oauth"})
		return
	}

	useLocalhost := c.Query("localhost") == "1"
	authURL, err := d.MCP.StartOAuth(context.Background(), conn, useLocalhost)
	if err != nil {
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}
	if authURL == "" {
		// token 已有效，不需要授权
		c.JSON(200, gin.H{"status": "already_authorized"})
		return
	}
	c.JSON(200, gin.H{"authorize_url": authURL})
}

// handleMCPOAuthLocalCallback 粘贴 localhost 回调 URL 完成授权。
// 部分 MCP Server（如 Cloudflare）不支持自定义回调域名，只接受 localhost。
// 用户在浏览器完成授权后，从地址栏复制完整 URL 粘贴到此接口。
func (d *Deps) handleMCPOAuthLocalCallback(c *gin.Context) {
	var req struct {
		CallbackURL string `json:"callback_url" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(400, gin.H{"error": err.Error()})
		return
	}

	u, err := url.Parse(req.CallbackURL)
	if err != nil {
		c.JSON(400, gin.H{"error": "无效的 URL"})
		return
	}
	code := u.Query().Get("code")
	state := u.Query().Get("state")
	if code == "" || state == "" {
		c.JSON(400, gin.H{"error": "URL 中缺少 code 或 state 参数"})
		return
	}

	connName, err := d.MCP.HandleOAuthCallback(context.Background(), code, state)
	if err != nil {
		c.JSON(400, gin.H{"error": err.Error()})
		return
	}
	c.JSON(200, gin.H{"connected": true, "name": connName})
}

// handleMCPOAuthCallback 处理 OAuth 回调。
func (d *Deps) handleMCPOAuthCallback(c *gin.Context) {
	code := c.Query("code")
	state := c.Query("state")
	if code == "" || state == "" {
		c.JSON(400, gin.H{"error": "missing code or state"})
		return
	}

	connName, err := d.MCP.HandleOAuthCallback(context.Background(), code, state)
	if err != nil {
		// 返回一个人类可读的 HTML 页面而非 JSON
		c.Data(http.StatusOK, "text/html; charset=utf-8", []byte(`<!DOCTYPE html>
<html><body>
<h2>授权失败</h2>
<p>`+err.Error()+`</p>
<p>你可以关闭此窗口。</p>
</body></html>`))
		return
	}

	// 成功 — 返回自动关闭弹窗的 HTML
	c.Data(http.StatusOK, "text/html; charset=utf-8", []byte(`<!DOCTYPE html>
<html><body>
<h2>授权成功</h2>
<p>MCP 连接 <b>`+connName+`</b> 已授权并连接。</p>
<p>此窗口将自动关闭…</p>
<script>
  if (window.opener) {
    window.opener.postMessage({type:'orca-mcp-oauth-done'}, '*');
  }
  setTimeout(function(){ window.close(); }, 1500);
</script>
</body></html>`))
}
