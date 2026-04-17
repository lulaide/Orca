package api

import (
	"net/http"

	"github.com/cloudwego/eino/schema"
	"github.com/gin-gonic/gin"

	"github.com/lulaide/orca/internal/config"
	"github.com/lulaide/orca/internal/core"
	"github.com/lulaide/orca/internal/db"
	"github.com/lulaide/orca/internal/llm"
)

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

// ---- /api/chat ----

type chatRequest struct {
	Message        string `json:"message" binding:"required"`
	ConversationID string `json:"conversation_id"` // 可选；空则新建对话
}

type chatResponse struct {
	ConversationID string         `json:"conversation_id"`
	Reply          string         `json:"reply"`
	Iterations     int            `json:"iterations"`
	// NewMessages 包含本轮产生的所有 assistant/tool 消息（不含用户那条，前端已有）。
	// 前端按 tool_call_id 把 tool 消息的 content 绑到 assistant 的 tool_calls 展示。
	NewMessages []core.Message `json:"new_messages"`
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

## Rules
- Be concise and actionable. No filler, no apologies, no restating the question.
- Reply in the same language as the user's message (中文优先).
- Never fabricate resource names, log lines, or tool output — only report what tools actually returned.
- If a tool errors, say what you tried and suggest the next step instead of guessing.
- For casual questions that don't require investigation, skip the steps and answer directly.`

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

	// 2. 加载历史（含之前的 tool_calls / tool 消息），组 eino History
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

	// 3. 保存当前用户消息
	if _, err := core.SaveEinoMessage(d.DB, conv.ID, schema.UserMessage(req.Message)); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "save user message: " + err.Error()})
		return
	}

	// 4. 跑 Agentic Loop
	result, err := d.Engine.Run(c.Request.Context(), llm.RunInput{
		SystemPrompt: chatSystemPrompt,
		UserMessage:  req.Message,
		History:      einoHistory,
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// 5. 保存本轮新消息（assistant tool_calls + tool results + 最终 assistant）
	newRows := make([]core.Message, 0, len(result.Messages))
	for _, m := range result.Messages {
		row, err := core.SaveEinoMessage(d.DB, conv.ID, m)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "save message: " + err.Error()})
			return
		}
		newRows = append(newRows, *row)
	}

	c.JSON(http.StatusOK, chatResponse{
		ConversationID: conv.ID,
		Reply:          result.Final.Content,
		Iterations:     result.Iterations,
		NewMessages:    newRows,
	})
}
