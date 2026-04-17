package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"github.com/cloudwego/eino/schema"
	"github.com/gin-gonic/gin"

	"github.com/lulaide/orca/internal/config"
	"github.com/lulaide/orca/internal/core"
	"github.com/lulaide/orca/internal/db"
	"github.com/lulaide/orca/internal/llm"
	"github.com/lulaide/orca/internal/tools"
)

// indexNewline 返回首个换行符位置（\n 或 \r），没有返回 -1。
func indexNewline(s string) int {
	return strings.IndexAny(s, "\r\n")
}

// ---- /api/status ----

func (d *Deps) handleStatus(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"llm":        d.LLM.Status(),
		"kubernetes":  d.Kube.Status(),
		"tools":      d.Registry.Names(),
	})
}

// ---- /api/settings/llm ----

func (d *Deps) handleGetLLMSettings(c *gin.Context) {
	c.JSON(http.StatusOK, d.LLM.Status())
}

func (d *Deps) handleUpdateLLMSettings(c *gin.Context) {
	var cfg config.LLMConfig
	if err := c.ShouldBindJSON(&cfg); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if err := d.LLM.Apply(cfg); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// 持久化到 settings 表
	if err := db.SaveSetting(d.DB, "llm", cfg, "api"); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "config applied but failed to persist: " + err.Error()})
		return
	}

	c.JSON(http.StatusOK, d.LLM.Status())
}

// ---- /api/settings/kubernetes ----

func (d *Deps) handleGetKubeSettings(c *gin.Context) {
	c.JSON(http.StatusOK, d.Kube.Status())
}

func (d *Deps) handleTestInCluster(c *gin.Context) {
	if err := d.Kube.UseInCluster(); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, d.Kube.Status())
}

type kubeconfigUpload struct {
	Content string `json:"content" binding:"required"`
}

func (d *Deps) handleUploadKubeconfig(c *gin.Context) {
	var body kubeconfigUpload
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if err := d.Kube.UseKubeconfigBytes([]byte(body.Content)); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// 持久化 kubeconfig 内容到 settings 表
	if err := db.SaveSetting(d.DB, "kubernetes", body, "api"); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "connected but failed to persist: " + err.Error()})
		return
	}

	c.JSON(http.StatusOK, d.Kube.Status())
}

func (d *Deps) handleDisconnectKube(c *gin.Context) {
	d.Kube.Disconnect()
	_ = db.DeleteSetting(d.DB, "kubernetes")
	c.JSON(http.StatusOK, d.Kube.Status())
}

// ---- /api/conversations ----

func (d *Deps) handleListConversations(c *gin.Context) {
	convs, err := core.ListConversations(d.DB)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, convs)
}

func (d *Deps) handleGetConversationMessages(c *gin.Context) {
	id := c.Param("id")
	if _, err := core.GetConversation(d.DB, id); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "conversation not found"})
		return
	}
	msgs, err := core.ListMessages(d.DB, id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, msgs)
}

func (d *Deps) handleDeleteConversation(c *gin.Context) {
	id := c.Param("id")
	if err := core.DeleteConversation(d.DB, id); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.Status(http.StatusNoContent)
}

// ---- /api/chat ----

type chatRequest struct {
	Message        string `json:"message" binding:"required"`
	ConversationID string `json:"conversation_id"` // 可选；空则新建对话
}

const chatSystemPrompt = `You are Orca, an AI SRE assistant for Kubernetes clusters. Follow this diagnostic process when investigating issues:

## Step 1: Gather Symptoms
- List pods in the relevant namespace with ` + "`get_pods`" + `
- Check recent events for warnings/errors with ` + "`get_events`" + `

## Step 2: Drill Down
- For unhealthy pods: fetch logs (tail ~50 lines) with ` + "`get_pod_logs`" + `
- For config/resource issues: use ` + "`describe_resource`" + `
- For node-level suspicion: use ` + "`get_node_status`" + `

## Step 3: Analyze
- Form a hypothesis about the root cause
- Verify evidence supports it; if not, loop back to Step 2

## Step 4: Conclude
- State the root cause clearly
- Propose an actionable solution (concrete commands or manifest changes)
- Rate confidence: high / medium / low

## Investigations (persistent tickets)
Use these tools ONLY when a problem deserves to be remembered and followed up across time or people:
- ` + "`create_investigation`" + ` — when you discover an issue that warrants tracking (e.g. repeated errors, ambiguous root cause, needs a human decision). Provide a concise title, what you observed, severity, and any related services.
- ` + "`add_investigation_entry`" + ` — append significant findings (` + "`discovery`" + `), performed actions (` + "`action`" + `), or side notes (` + "`note`" + `). Do NOT use for resolution.
- ` + "`resolve_investigation`" + ` — close an investigation with root cause + solution AFTER you are confident. This automatically writes a resolution entry.

Do NOT open investigations for casual or one-off questions. Archiving and hard-deletion are human-only operations.

## Rules
- Be concise and actionable. No filler, no apologies, no restating the question.
- Reply in the same language as the user's message (中文优先).
- Never fabricate resource names, log lines, or tool output — only report what tools actually returned.
- If a tool errors, say what you tried and suggest the next step instead of guessing.
- For casual questions that don't require investigation, skip the steps and answer directly.`

// handleChat 以 SSE 流式返回:
//   - event: message, data: core.Message JSON         每产生一条新消息就推送(含 user/assistant/tool)
//   - event: done,    data: {conversation_id, iterations}  全部完成
//   - event: error,   data: {error}                   出错(之前已推送的消息仍然有效)
func (d *Deps) handleChat(c *gin.Context) {
	var req chatRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// 1. 找到或新建 Conversation
	var conv *core.Conversation
	if req.ConversationID == "" {
		cv, err := core.CreateConversation(d.DB, "")
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "create conversation: " + err.Error()})
			return
		}
		conv = cv
	} else {
		cv, err := core.GetConversation(d.DB, req.ConversationID)
		if err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "conversation not found"})
			return
		}
		conv = cv
	}

	// 2. 加载历史
	historyRows, err := core.ListMessages(d.DB, conv.ID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "load history: " + err.Error()})
		return
	}
	einoHistory, err := core.ToEinoMessages(historyRows)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "decode history: " + err.Error()})
		return
	}

	// 3. 切换为 SSE 模式
	c.Header("Content-Type", "text/event-stream")
	c.Header("Cache-Control", "no-cache")
	c.Header("Connection", "keep-alive")
	c.Header("X-Accel-Buffering", "no") // 反代友好:禁止 nginx/cloudflare 缓冲
	flusher, ok := c.Writer.(http.Flusher)
	if !ok {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "streaming not supported"})
		return
	}

	emit := func(event string, data any) error {
		b, err := json.Marshal(data)
		if err != nil {
			return err
		}
		if _, err := fmt.Fprintf(c.Writer, "event: %s\ndata: %s\n\n", event, b); err != nil {
			return err
		}
		flusher.Flush()
		return nil
	}

	// 4. 保存 + 推送用户消息
	userRow, err := core.SaveEinoMessage(d.DB, conv.ID, schema.UserMessage(req.Message))
	if err != nil {
		_ = emit("error", gin.H{"error": "save user message: " + err.Error()})
		return
	}
	if err := emit("message", userRow); err != nil {
		return // 客户端断开,放弃继续
	}

	// 首条用户消息时自动填充标题（取首行 + 截断）
	if conv.Title == "" {
		title := req.Message
		if i := indexNewline(title); i >= 0 {
			title = title[:i]
		}
		_ = core.SetConversationTitle(d.DB, conv.ID, title)
	}
	_ = core.TouchConversation(d.DB, conv.ID)

	// 5. 跑 Agentic Loop,每产生一条消息即存 + 推
	// 注入 conversation_id,供 investigation 工具关联到当前对话
	ctx := context.WithValue(c.Request.Context(), tools.ConversationIDKey, conv.ID)
	result, runErr := d.Engine.Run(ctx, llm.RunInput{
		SystemPrompt: chatSystemPrompt,
		UserMessage:  req.Message,
		History:      einoHistory,
		OnMessage: func(m *schema.Message) {
			row, err := core.SaveEinoMessage(d.DB, conv.ID, m)
			if err != nil {
				_ = emit("error", gin.H{"error": "save message: " + err.Error()})
				return
			}
			_ = emit("message", row)
		},
	})
	if runErr != nil {
		_ = emit("error", gin.H{"error": runErr.Error()})
		return
	}

	// 6. done 帧
	_ = emit("done", gin.H{
		"conversation_id": conv.ID,
		"iterations":      result.Iterations,
	})
}
