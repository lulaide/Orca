package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/cloudwego/eino/schema"
	"github.com/gin-gonic/gin"

	"github.com/lulaide/orca/internal/core"
	"github.com/lulaide/orca/internal/knowledge"
	"github.com/lulaide/orca/internal/llm"
)

const scanSystemPrompt = `你是 Orca 的知识库文档生成 Agent。你的任务是探索 Kubernetes 集群，生成一套结构化的**集群架构知识文档**。

## 核心原则

知识库记录的是**集群里有什么、每个组件是干什么的、它们之间怎么协作**。
这不是监控面板——**不要写任何运行状态、健康状态、Pod 是否正常、最近有没有事件**这类运行时信息。
专注于：用途、职责、架构关系、配置特征、技术选型。

## 工作流程

1. **先查看当前知识库**：调用 list_knowledge_pages 了解已有文档。
2. **探索集群全貌**：用 get_pods（所有 namespace）获取完整的工作负载列表。
3. **深入了解每个服务**：用 describe_resource 查看 Deployment/StatefulSet/DaemonSet 的配置细节（镜像、端口、挂载、环境变量、资源配置等），用它们推断服务的用途和角色。
4. **如果有文档搜索类 MCP 工具**（如飞书文档、Outline 等），搜索每个服务名/项目名的相关文档，获取业务描述、负责人、设计文档等信息来丰富内容。
5. **按以下结构生成文档**，每篇调用 write_knowledge_page 写入。

## 文档结构

**第一层（顶级页面，parent_slug 为空）：**

- slug="overview", title="集群概述"
  内容：集群的整体定位和用途、包含哪些 namespace 及各自的职责划分、关键服务一览表（表格：服务名 / namespace / 类型 / 一句话描述）、技术栈总结。

- slug="architecture", title="服务架构与依赖"
  内容：服务之间的调用关系和依赖链（谁是入口网关、谁提供 DNS、谁是数据库、哪些服务暴露了外部域名）、流量从外部请求到后端的完整链路、存储层和中间件的角色。用文字描述架构，可以用列表或表格辅助。

**第二层（namespace 页面，parent_slug="overview"）：**

- slug="ns/{namespace}", title="{namespace}"
  内容：这个 namespace 的定位和用途（为什么存在、承载什么类型的服务）、包含的服务列表及各自的一句话描述。

**第三层（服务页面，parent_slug="ns/{namespace}"）：**

- slug="svc/{namespace}/{name}", title="{name}"
  内容：
  - **用途**：这个服务是做什么的，在集群中扮演什么角色
  - **技术信息**：类型（Deployment/StatefulSet/DaemonSet）、镜像、暴露端口、挂载卷、关键环境变量/配置
  - **对外暴露**：是否有 Service、Ingress、域名
  - **依赖关系**：依赖哪些其他服务，被哪些服务依赖
  - **补充信息**：从 MCP 文档工具搜索到的业务描述、负责人、文档链接等（如果有）

## 内容要求

- **全部使用中文**
- **Markdown 格式**，善用标题（##/###）、表格、列表
- 概述页面要有全局视角和总结分析，不是简单罗列
- 架构页面要梳理清楚服务间关系，不是把每个服务单独说一遍
- 每个服务页面要解释清楚"它是干什么的"，而不是"它现在怎么样"
- **禁止写**：Pod 是否 Running、Ready 数量、最近事件、健康状态、"运行正常"之类的运行时描述

## 排序

- overview: sort_order=0
- architecture: sort_order=1
- namespace 页面: sort_order 按字母序
- 服务页面: sort_order 按重要性（基础设施在前，业务应用在后）

## 输出

最后用中文简短总结：生成了多少篇文档、覆盖了哪些 namespace。`

// handleScanCluster 通过 Agent Loop 自主探索集群并生成知识文档。
// SSE 流式返回 Agent 的每步操作（工具调用 + 工具结果），前端实时展示进度。
func (d *Deps) handleScanCluster(c *gin.Context) {
	if d.Engine == nil || d.LLM.ChatModel() == nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "LLM 未配置"})
		return
	}
	if d.Kube.Clientset() == nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Kubernetes 未连接"})
		return
	}

	// 清空旧文档（全量重建）
	_ = knowledge.DeleteAllPages(d.DB)

	// SSE headers — 前端用来观察进度，但 Agent 在后台独立运行，
	// 浏览器关闭不影响生成。
	c.Header("Content-Type", "text/event-stream")
	c.Header("Cache-Control", "no-cache")
	c.Header("Connection", "keep-alive")
	c.Header("Access-Control-Allow-Origin", "*")
	c.Writer.Flush()

	// Agent 用独立的 background context，不绑定 HTTP 请求生命周期。
	bgCtx, bgCancel := context.WithTimeout(context.Background(), 5*time.Minute)

	// SSE emit：如果 HTTP 连接还活着就推，断了就静默跳过。
	clientGone := c.Request.Context().Done()
	emit := func(event string, data any) {
		select {
		case <-clientGone:
			return // 浏览器已断开，不推
		default:
		}
		j, _ := json.Marshal(data)
		fmt.Fprintf(c.Writer, "event: %s\ndata: %s\n\n", event, j)
		c.Writer.Flush()
	}

	// 后台 goroutine 跑 Agent，SSE 只是观察窗口。
	done := make(chan struct{})
	go func() {
		defer bgCancel()
		defer close(done)

		result, err := d.Engine.Run(bgCtx, llm.RunInput{
			SystemPrompt: scanSystemPrompt,
			UserMessage:  "请开始探索集群并生成知识库文档。",
			OnMessage: func(m *schema.Message) {
				if m == nil {
					return
				}
				msg := map[string]any{
					"role":    string(m.Role),
					"content": m.Content,
				}
				if len(m.ToolCalls) > 0 {
					calls := make([]map[string]string, len(m.ToolCalls))
					for i, tc := range m.ToolCalls {
						calls[i] = map[string]string{
							"id":        tc.ID,
							"name":      tc.Function.Name,
							"arguments": tc.Function.Arguments,
						}
					}
					msg["tool_calls"] = calls
				}
				if m.ToolCallID != "" {
					msg["tool_call_id"] = m.ToolCallID
					msg["tool_name"] = m.ToolName
				}
				emit("message", msg)
			},
		})

		if err != nil {
			emit("error", map[string]string{"error": err.Error()})
			return
		}
		summary := ""
		if result != nil && result.Final != nil {
			summary = result.Final.Content
		}
		emit("done", map[string]any{
			"summary":    summary,
			"iterations": result.Iterations,
		})
	}()

	// 等 Agent 完成或浏览器断开（先发生哪个）。
	// Agent 在后台继续跑，SSE 连接可以提前关闭。
	select {
	case <-done:
		// Agent 完成，SSE 正常结束
	case <-clientGone:
		// 浏览器关了，但 Agent 继续跑，HTTP handler 返回即可
	}
}

// handleListKnowledgePages 列出所有知识页面（目录结构）。
func (d *Deps) handleListKnowledgePages(c *gin.Context) {
	pages, err := knowledge.ListPages(d.DB)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if pages == nil {
		pages = []core.KnowledgePage{}
	}
	c.JSON(http.StatusOK, pages)
}

// handleGetKnowledgePage 获取单篇知识页面。
func (d *Deps) handleGetKnowledgePage(c *gin.Context) {
	slug := c.Param("slug")
	// gin 的 wildcard 会带前缀 /
	if len(slug) > 0 && slug[0] == '/' {
		slug = slug[1:]
	}
	page, err := knowledge.GetPage(d.DB, slug)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
		return
	}
	c.JSON(http.StatusOK, page)
}

// handleUpdateKnowledgePage 人工编辑页面内容。
func (d *Deps) handleUpdateKnowledgePage(c *gin.Context) {
	slug := c.Param("slug")
	if len(slug) > 0 && slug[0] == '/' {
		slug = slug[1:]
	}
	var body struct {
		Content string `json:"content"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	page, err := knowledge.UpdatePageContent(d.DB, slug, body.Content)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, page)
}
