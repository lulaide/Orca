package api

import (
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"github.com/lulaide/orca/internal/kube"
	"github.com/lulaide/orca/internal/llm"
	"github.com/lulaide/orca/internal/tools"
)

// Deps 是 API 层依赖的所有模块,由 main.go 组装后传入。
type Deps struct {
	DB       *gorm.DB
	LLM      *llm.Manager
	Kube     *kube.Manager
	Engine   *llm.Engine
	Registry *tools.Registry
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

		// Settings: LLM
		api.GET("/settings/llm", d.handleGetLLMSettings)
		api.PUT("/settings/llm", d.handleUpdateLLMSettings)

		// Settings: Kubernetes
		api.GET("/settings/kubernetes", d.handleGetKubeSettings)
		api.POST("/settings/kubernetes/in-cluster", d.handleTestInCluster)
		api.POST("/settings/kubernetes/kubeconfig", d.handleUploadKubeconfig)
		api.DELETE("/settings/kubernetes", d.handleDisconnectKube)

		// Chat: 最简的对话入口
		api.POST("/chat", d.handleChat)
	}

	return r
}
