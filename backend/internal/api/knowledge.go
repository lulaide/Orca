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

const scanSystemPrompt = `你是 Orca 的知识库文档生成 Agent。你的任务是探索 Kubernetes 集群，生成一套结构化的集群知识文档。

## 工作流程

1. **先查看当前知识库**：调用 list_knowledge_pages 了解已有文档。
2. **探索集群全貌**：用 get_pods（所有 namespace）获取完整的工作负载列表。
3. **深入了解关键服务**：对重要的服务用 describe_resource、get_pod_logs、get_events 深入了解。
4. **如果有文档搜索类 MCP 工具**（如飞书文档、Outline 等），搜索每个服务的相关文档来补充描述。
5. **按以下结构生成文档**，每篇调用 write_knowledge_page 写入：

### 文档结构要求

必须按这个层次生成：

**第一层（顶级页面，parent_slug 为空）：**
- slug="overview", title="集群概述" — 集群整体情况：有多少个 namespace、多少个工作负载、整体健康状态、关键服务列表
- slug="architecture", title="服务架构" — 服务之间的关系和依赖（如 traefik 是入口网关，coredns 提供 DNS，哪些服务暴露了 Ingress）

**第二层（namespace 页面，parent_slug="overview"）：**
- slug="ns/{namespace}", title="{namespace} 命名空间" — 该 namespace 的用途、包含的服务概览、健康状态

**第三层（服务页面，parent_slug="ns/{namespace}"）：**
- slug="svc/{namespace}/{name}", title="{name}" — 服务详情：
  - 基本信息（Kind / Image / Pod 数量 / 端口 / 域名）
  - 运行状态和最近事件
  - 服务描述和用途（结合 MCP 文档工具搜索到的信息）
  - 相关依赖和被依赖关系

## 内容要求

- **全部使用中文**
- **Markdown 格式**，善用标题、列表、表格、代码块
- 概述页面要有全局视角，不只是罗列，要分析和总结
- 服务架构页面要描述服务之间的关系，不只是列清单
- 每篇内容要有实质信息，不要只有标题和空列表

## 排序

- overview: sort_order=0
- architecture: sort_order=1
- namespace 页面: sort_order 按字母序
- 服务页面: sort_order 按重要性（系统关键服务在前）

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

	// SSE headers
	c.Header("Content-Type", "text/event-stream")
	c.Header("Cache-Control", "no-cache")
	c.Header("Connection", "keep-alive")
	c.Header("Access-Control-Allow-Origin", "*")
	c.Writer.Flush()

	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Minute)
	defer cancel()

	emit := func(event string, data any) {
		j, _ := json.Marshal(data)
		fmt.Fprintf(c.Writer, "event: %s\ndata: %s\n\n", event, j)
		c.Writer.Flush()
	}

	result, err := d.Engine.Run(ctx, llm.RunInput{
		SystemPrompt: scanSystemPrompt,
		UserMessage:  "请开始探索集群并生成知识库文档。",
		OnMessage: func(m *schema.Message) {
			if m == nil {
				return
			}
			// 把每条消息推给前端
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
