package api

import (
	"embed"
	"io/fs"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"github.com/lulaide/orca/internal/auth"
	"github.com/lulaide/orca/internal/notify"
	"github.com/lulaide/orca/internal/dispatch"
	"github.com/lulaide/orca/internal/kube"
	"github.com/lulaide/orca/internal/llm"
	"github.com/lulaide/orca/internal/mcp"
	"github.com/lulaide/orca/internal/tools"
	"github.com/lulaide/orca/internal/triggers"
)

// Deps 是 API 层依赖的所有模块,由 main.go 组装后传入。
type Deps struct {
	DB         *gorm.DB
	LLM        *llm.Manager
	Kube       *kube.Manager
	Engine     *llm.Engine
	Registry   *tools.Registry
	Triggers   *triggers.Registry
	Router     *dispatch.EventRouter
	MCP        *mcp.Manager
	FrontendFS embed.FS
	JWTSecret  string
	OAuth      *auth.OAuthManager
	Notify     *notify.Manager
}

// NewRouter 创建并返回 gin 路由。
func NewRouter(d *Deps) *gin.Engine {
	r := gin.Default()

	// CORS
	r.Use(func(c *gin.Context) {
		c.Header("Access-Control-Allow-Origin", "*")
		c.Header("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
		c.Header("Access-Control-Allow-Headers", "Content-Type, Authorization")
		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(204)
			return
		}
		c.Next()
	})

	// ---- 公开路由（无需认证）----

	r.GET("/healthz", func(c *gin.Context) {
		c.JSON(200, gin.H{"status": "ok"})
	})

	// 认证
	authGroup := r.Group("/api/auth")
	{
		authGroup.GET("/status", d.handleAuthStatus)
		authGroup.POST("/setup", d.handleAuthSetup)
		authGroup.POST("/login", d.handleAuthLogin)
		authGroup.GET("/oauth/authorize", d.handleOAuthAuthorize)
		authGroup.GET("/oauth/callback", d.handleOAuthCallback)
	}

	// Webhook（用 plugin secret token 自带认证）
	r.POST("/api/webhooks/:plugin", d.handleWebhook)

	// MCP OAuth 回调（外部跳转回来）
	r.GET("/api/mcp/oauth/callback", d.handleMCPOAuthCallback)

	// ---- 需要认证的路由 ----

	api := r.Group("/api", auth.RequireAuth(d.JWTSecret))
	{
		// 系统状态
		api.GET("/status", d.handleStatus)
		api.GET("/cluster/metrics", d.handleClusterMetrics)
		api.GET("/cluster/overview", d.handleClusterOverview)

		// 设置: 站点
		api.GET("/settings/site", d.handleGetSiteSettings)
		api.PUT("/settings/site", d.handleUpdateSiteSettings)

		// 设置: 通知
		api.GET("/settings/notification", d.handleGetNotificationSettings)
		api.PUT("/settings/notification", d.handleUpdateNotificationSettings)
		api.POST("/settings/notification/test", d.handleTestNotification)

		// 设置: OAuth
		api.GET("/auth/oauth/config", d.handleGetOAuthConfig)
		api.POST("/auth/oauth/config", d.handleSetOAuthConfig)

		// 设置: LLM
		api.GET("/settings/llm", d.handleGetLLMSettings)
		api.PUT("/settings/llm", d.handleUpdateLLMSettings)
		api.POST("/settings/llm/test", d.handleTestLLM)

		// 设置: Kubernetes
		api.GET("/settings/kubernetes", d.handleGetKubeSettings)
		api.POST("/settings/kubernetes/in-cluster", d.handleTestInCluster)
		api.POST("/settings/kubernetes/kubeconfig", d.handleUploadKubeconfig)
		api.DELETE("/settings/kubernetes", d.handleDisconnectKube)

		// 对话
		api.GET("/conversations", d.handleListConversations)
		api.GET("/conversations/:id/messages", d.handleGetConversationMessages)
		api.DELETE("/conversations/:id", d.handleDeleteConversation)
		api.POST("/conversations/:id/fork", d.handleForkConversation)
		api.GET("/conversations/:id/investigations", d.handleListConversationInvestigations)
		api.DELETE("/conversations/:id/investigations/:inv_id", d.handleUnlinkConversationInvestigation)

		// 调查
		api.GET("/investigations", d.handleListInvestigations)
		api.POST("/investigations", d.handleCreateInvestigation)
		api.GET("/investigations/:id", d.handleGetInvestigation)
		api.PATCH("/investigations/:id", d.handleUpdateInvestigation)
		api.POST("/investigations/:id/archive", d.handleArchiveInvestigation)
		api.POST("/investigations/:id/unarchive", d.handleUnarchiveInvestigation)
		api.GET("/investigations/:id/entries", d.handleListInvestigationEntries)
		api.POST("/investigations/:id/entries", d.handleCreateInvestigationEntry)

		// 对话
		api.POST("/chat", d.handleChat)

		// 事件
		api.GET("/events", d.handleListEvents)
		api.GET("/events/:id", d.handleGetEvent)

		// 插件
		api.GET("/plugins", d.handleListPlugins)
		api.POST("/plugins/:name/enable", d.handleEnablePlugin)
		api.POST("/plugins/:name/disable", d.handleDisablePlugin)
		api.POST("/plugins/:name/regenerate-token", d.handleRegeneratePluginToken)
		api.GET("/plugins/:name/token", d.handleGetPluginToken)

		// 知识库
		api.POST("/knowledge/scan", d.handleScanCluster)
		api.GET("/knowledge/scan/stream", d.handleScanStream)
		api.GET("/knowledge/pages", d.handleListKnowledgePages)
		api.GET("/knowledge/pages/*slug", d.handleGetKnowledgePage)
		api.PATCH("/knowledge/pages/*slug", d.handleUpdateKnowledgePage)

		// MCP 连接
		api.GET("/mcp/connections", d.handleListMCPConnections)
		api.POST("/mcp/connections", d.handleCreateMCPConnection)
		api.GET("/mcp/connections/:id", d.handleGetMCPConnection)
		api.PATCH("/mcp/connections/:id", d.handleUpdateMCPConnection)
		api.DELETE("/mcp/connections/:id", d.handleDeleteMCPConnection)
		api.POST("/mcp/connections/:id/reconnect", d.handleReconnectMCPConnection)
		api.GET("/mcp/connections/:id/oauth/authorize", d.handleMCPOAuthAuthorize)
		api.POST("/mcp/connections/:id/oauth/local-callback", d.handleMCPOAuthLocalCallback)
	}

	// 前端静态文件
	if sub, err := fs.Sub(d.FrontendFS, "dist"); err == nil {
		fsys := http.FS(sub)
		fileServer := http.FileServer(fsys)
		r.NoRoute(func(c *gin.Context) {
			path := c.Request.URL.Path
			if strings.HasPrefix(path, "/api") || path == "/healthz" {
				c.JSON(404, gin.H{"error": "not found"})
				return
			}
			if f, err := fsys.Open(path); err == nil {
				f.Close()
				fileServer.ServeHTTP(c.Writer, c.Request)
				return
			}
			c.Request.URL.Path = "/"
			fileServer.ServeHTTP(c.Writer, c.Request)
		})
	}

	return r
}
