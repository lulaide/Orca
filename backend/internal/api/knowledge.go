package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"time"

	"github.com/cloudwego/eino/schema"
	"github.com/gin-gonic/gin"

	"github.com/lulaide/orca/internal/core"
	"github.com/lulaide/orca/internal/knowledge"
	"github.com/lulaide/orca/internal/llm"
)

// scanState 维护一次知识库扫描的后台状态。
// 多个 SSE 客户端可以订阅同一次扫描的消息流。
type scanState struct {
	mu        sync.Mutex
	running   bool
	messages  []json.RawMessage // 已产生的所有 SSE 消息（event+data JSON）
	done      bool
	subs      []chan struct{}   // 新消息通知
}

type sseFrame struct {
	Event string `json:"event"`
	Data  any    `json:"data"`
}

var globalScan = &scanState{}

func (s *scanState) start() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.running {
		return false // 已在运行
	}
	s.running = true
	s.done = false
	s.messages = nil
	s.subs = nil
	return true
}

func (s *scanState) push(event string, data any) {
	frame := sseFrame{Event: event, Data: data}
	j, _ := json.Marshal(frame)
	s.mu.Lock()
	s.messages = append(s.messages, j)
	if event == "done" || event == "error" {
		s.done = true
		s.running = false
	}
	subs := append([]chan struct{}{}, s.subs...)
	s.mu.Unlock()
	// 通知所有订阅者
	for _, ch := range subs {
		select {
		case ch <- struct{}{}:
		default:
		}
	}
}

func (s *scanState) subscribe() (ch chan struct{}, unsub func()) {
	ch = make(chan struct{}, 1)
	s.mu.Lock()
	s.subs = append(s.subs, ch)
	s.mu.Unlock()
	return ch, func() {
		s.mu.Lock()
		for i, c := range s.subs {
			if c == ch {
				s.subs = append(s.subs[:i], s.subs[i+1:]...)
				break
			}
		}
		s.mu.Unlock()
	}
}

func (s *scanState) snapshot() (msgs []json.RawMessage, isDone bool, isRunning bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	msgs = append([]json.RawMessage{}, s.messages...)
	return msgs, s.done, s.running
}

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

// handleScanCluster 启动一次后台知识库扫描。
// 如果已在运行则返回 409。启动后立即返回，前端通过 /api/knowledge/scan/stream 订阅进度。
func (d *Deps) handleScanCluster(c *gin.Context) {
	if d.Engine == nil || d.LLM.ChatModel() == nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "LLM 未配置"})
		return
	}
	if d.Kube.Clientset() == nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Kubernetes 未连接"})
		return
	}

	if !globalScan.start() {
		c.JSON(http.StatusConflict, gin.H{"error": "扫描正在进行中"})
		return
	}

	// 清空旧文档（全量重建）
	_ = knowledge.DeleteAllPages(d.DB)

	bgCtx, bgCancel := context.WithTimeout(context.Background(), 30*time.Minute)

	go func() {
		defer bgCancel()

		buildMsg := func(m *schema.Message) map[string]any {
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
			return msg
		}

		result, err := d.Engine.Run(bgCtx, llm.RunInput{
			SystemPrompt: scanSystemPrompt,
			UserMessage:  "请开始探索集群并生成知识库文档。",
			OnMessage: func(m *schema.Message) {
				if m == nil {
					return
				}
				globalScan.push("message", buildMsg(m))
			},
		})

		if err != nil {
			globalScan.push("error", map[string]string{"error": err.Error()})
			return
		}
		summary := ""
		if result != nil && result.Final != nil {
			summary = result.Final.Content
		}
		globalScan.push("done", map[string]any{
			"summary":    summary,
			"iterations": result.Iterations,
		})
	}()

	c.JSON(http.StatusAccepted, gin.H{"status": "started"})
}

// handleScanStream SSE 订阅扫描进度。
// 先回放已有消息，然后实时推送新消息，直到扫描完成或客户端断开。
// 如果没有正在进行的扫描且没有历史消息，返回 204。
func (d *Deps) handleScanStream(c *gin.Context) {
	msgs, isDone, isRunning := globalScan.snapshot()
	if !isRunning && len(msgs) == 0 {
		c.JSON(http.StatusNoContent, nil)
		return
	}

	c.Header("Content-Type", "text/event-stream")
	c.Header("Cache-Control", "no-cache")
	c.Header("Connection", "keep-alive")
	c.Header("Access-Control-Allow-Origin", "*")
	c.Writer.Flush()

	clientGone := c.Request.Context().Done()

	emitRaw := func(raw json.RawMessage) {
		var frame sseFrame
		_ = json.Unmarshal(raw, &frame)
		j, _ := json.Marshal(frame.Data)
		fmt.Fprintf(c.Writer, "event: %s\ndata: %s\n\n", frame.Event, j)
		c.Writer.Flush()
	}

	// 回放历史消息
	for _, m := range msgs {
		select {
		case <-clientGone:
			return
		default:
		}
		emitRaw(m)
	}

	if isDone {
		return // 已完成，不需要等
	}

	// 订阅新消息
	notify, unsub := globalScan.subscribe()
	defer unsub()

	cursor := len(msgs)
	for {
		select {
		case <-clientGone:
			return
		case <-notify:
			newMsgs, done, _ := globalScan.snapshot()
			for i := cursor; i < len(newMsgs); i++ {
				emitRaw(newMsgs[i])
			}
			cursor = len(newMsgs)
			if done {
				return
			}
		}
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
