package api

import (
	"embed"
	"io/fs"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

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
	FrontendFS embed.FS // cmd/orca/dist/* 嵌入的前端静态文件
}

// NewRouter 创建并返回 gin 路由。
func NewRouter(d *Deps) *gin.Engine {
	r := gin.Default()

	// CORS: 开发时前端在 localhost:5173,后端在 localhost:8080
	r.Use(func(c *gin.Context) {
		c.Header("Access-Control-Allow-Origin", "*")
		c.Header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		c.Header("Access-Control-Allow-Headers", "Content-Type, Authorization")
		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(204)
			return
		}
		c.Next()
	})

	// 健康检查
	r.GET("/healthz", func(c *gin.Context) {
		c.JSON(200, gin.H{"status": "ok"})
	})

	api := r.Group("/api")
	{
		// 系统状态概览
		api.GET("/status", d.handleStatus)
		api.GET("/cluster/metrics", d.handleClusterMetrics)

		// Settings: LLM
		api.GET("/settings/llm", d.handleGetLLMSettings)
		api.PUT("/settings/llm", d.handleUpdateLLMSettings)
		api.POST("/settings/llm/test", d.handleTestLLM)

		// Settings: Kubernetes
		api.GET("/settings/kubernetes", d.handleGetKubeSettings)
		api.POST("/settings/kubernetes/in-cluster", d.handleTestInCluster)
		api.POST("/settings/kubernetes/kubeconfig", d.handleUploadKubeconfig)
		api.DELETE("/settings/kubernetes", d.handleDisconnectKube)

		// Conversations
		api.GET("/conversations", d.handleListConversations)
		api.GET("/conversations/:id/messages", d.handleGetConversationMessages)
		api.DELETE("/conversations/:id", d.handleDeleteConversation)
		api.GET("/conversations/:id/investigations", d.handleListConversationInvestigations)
		api.DELETE("/conversations/:id/investigations/:inv_id", d.handleUnlinkConversationInvestigation)

		// Investigations
		api.GET("/investigations", d.handleListInvestigations)
		api.POST("/investigations", d.handleCreateInvestigation)
		api.GET("/investigations/:id", d.handleGetInvestigation)
		api.PATCH("/investigations/:id", d.handleUpdateInvestigation)
		api.POST("/investigations/:id/archive", d.handleArchiveInvestigation)
		api.POST("/investigations/:id/unarchive", d.handleUnarchiveInvestigation)
		api.GET("/investigations/:id/entries", d.handleListInvestigationEntries)
		api.POST("/investigations/:id/entries", d.handleCreateInvestigationEntry)

		// Chat: 最简的对话入口
		api.POST("/chat", d.handleChat)

		// Events: 事件列表 + 详情（反查关联 Investigation）
		api.GET("/events", d.handleListEvents)
		api.GET("/events/:id", d.handleGetEvent)

		// Plugins: 触发插件的注册 + 启停 + token 管理
		api.GET("/plugins", d.handleListPlugins)
		api.POST("/plugins/:name/enable", d.handleEnablePlugin)
		api.POST("/plugins/:name/disable", d.handleDisablePlugin)
		api.POST("/plugins/:name/regenerate-token", d.handleRegeneratePluginToken)
		api.GET("/plugins/:name/token", d.handleGetPluginToken)

		// Knowledge: 知识库文档
		api.POST("/knowledge/scan", d.handleScanCluster)
		api.GET("/knowledge/pages", d.handleListKnowledgePages)
		api.GET("/knowledge/pages/*slug", d.handleGetKnowledgePage)
		api.PATCH("/knowledge/pages/*slug", d.handleUpdateKnowledgePage)

		// MCP: 外部 MCP Server 连接管理
		api.GET("/mcp/connections", d.handleListMCPConnections)
		api.POST("/mcp/connections", d.handleCreateMCPConnection)
		api.GET("/mcp/connections/:id", d.handleGetMCPConnection)
		api.PATCH("/mcp/connections/:id", d.handleUpdateMCPConnection)
		api.DELETE("/mcp/connections/:id", d.handleDeleteMCPConnection)
		api.POST("/mcp/connections/:id/reconnect", d.handleReconnectMCPConnection)
		api.GET("/mcp/connections/:id/oauth/authorize", d.handleMCPOAuthAuthorize)
		api.GET("/mcp/oauth/callback", d.handleMCPOAuthCallback)

		// Webhooks: 所有 Trigger 插件共享入口
		api.POST("/webhooks/:plugin", d.handleWebhook)
	}

	// 前端静态文件 — embed.FS 里的 dist/ 子目录。
	// 开发时 dist/ 里只有 .gitkeep，前端走 Vite dev server 代理；
	// 生产镜像构建时 npm run build 输出复制到 dist/，embed 自动包含。
	if sub, err := fs.Sub(d.FrontendFS, "dist"); err == nil {
		fsys := http.FS(sub)
		fileServer := http.FileServer(fsys)
		r.NoRoute(func(c *gin.Context) {
			path := c.Request.URL.Path
			// 跳过 /api 和 /healthz
			if strings.HasPrefix(path, "/api") || path == "/healthz" {
				c.JSON(404, gin.H{"error": "not found"})
				return
			}
			// 尝试精确匹配静态文件（JS/CSS/SVG/图片等）
			if f, err := fsys.Open(path); err == nil {
				f.Close()
				fileServer.ServeHTTP(c.Writer, c.Request)
				return
			}
			// SPA fallback: 所有其他路径返回 index.html
			c.Request.URL.Path = "/"
			fileServer.ServeHTTP(c.Writer, c.Request)
		})
	}

	return r
}
