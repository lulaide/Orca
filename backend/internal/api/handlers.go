package api

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/cloudwego/eino/schema"
	"github.com/gin-gonic/gin"

	"github.com/lulaide/orca/internal/auth"
	"github.com/lulaide/orca/internal/config"
	"github.com/lulaide/orca/internal/core"
	"github.com/lulaide/orca/internal/db"
	"github.com/lulaide/orca/internal/knowledge"
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

// handleTestLLM 向当前配置的 LLM 发一条最简消息，验证 API 可达 + 密钥有效。
func (d *Deps) handleTestLLM(c *gin.Context) {
	cm := d.LLM.ChatModel()
	if cm == nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "LLM 未配置"})
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), 15*time.Second)
	defer cancel()

	resp, err := cm.Generate(ctx, []*schema.Message{
		schema.UserMessage("ping"),
	})
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"ok": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "reply": resp.Content})
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
	userID := auth.GetUserID(c)
	convs, err := core.ListConversations(d.DB, userID)
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

func (d *Deps) handleForkConversation(c *gin.Context) {
	userID := auth.GetUserID(c)
	conv, err := core.ForkConversation(d.DB, c.Param("id"), userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, conv)
}

func (d *Deps) handleDeleteConversation(c *gin.Context) {
	id := c.Param("id")
	if err := core.DeleteConversation(d.DB, id); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.Status(http.StatusNoContent)
}

// ---- /api/conversations/:id/investigations ----

func (d *Deps) handleListConversationInvestigations(c *gin.Context) {
	convID := c.Param("id")
	if _, err := core.GetConversation(d.DB, convID); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "conversation not found"})
		return
	}
	invs, err := core.ListInvestigationsByConversation(d.DB, convID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, invs)
}

func (d *Deps) handleUnlinkConversationInvestigation(c *gin.Context) {
	convID := c.Param("id")
	invID := c.Param("inv_id")
	if err := d.DB.Where("conversation_id = ? AND investigation_id = ?", convID, invID).
		Delete(&core.ConversationInvestigation{}).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.Status(http.StatusNoContent)
}

// ---- /api/chat ----

type chatRequest struct {
	Message                    string   `json:"message" binding:"required"`
	ConversationID             string   `json:"conversation_id"`              // 可选；空则新建对话
	ReferencedInvestigationIDs []string `json:"referenced_investigation_ids"` // 可选；用户通过 picker 引用的 investigation
}

// referencedInvestigation 是写入 message metadata 的精简引用记录，
// 前端 UserMessage 据此渲染 RefCard，不必再次拉 detail。
type referencedInvestigation struct {
	ID       string `json:"id"`
	Title    string `json:"title"`
	Severity string `json:"severity"`
	Status   string `json:"status"`
}

// chatSystemPrompt 已移至 llm.ChatSystemPrompt，Web 和飞书对话共用。

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
		cv, err := core.CreateConversation(d.DB, "", "chat", auth.GetUserID(c))
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

	// 4. 解析引用的 investigation（若有），去重 + resolve 每个 id
	var refs []referencedInvestigation
	if len(req.ReferencedInvestigationIDs) > 0 {
		seen := map[string]bool{}
		for _, id := range req.ReferencedInvestigationIDs {
			if id == "" || seen[id] {
				continue
			}
			seen[id] = true
			inv, err := core.GetInvestigation(d.DB, id)
			if err != nil {
				// 忽略不存在的 id，不阻塞消息发送
				continue
			}
			refs = append(refs, referencedInvestigation{
				ID:       inv.ID,
				Title:    inv.Title,
				Severity: inv.Severity,
				Status:   inv.Status,
			})
			// 同步写入对话-调查关联表（幂等）
			_ = core.AppendInvestigationToConversation(d.DB, conv.ID, inv.ID)
		}
	}
	var metadata map[string]any
	if len(refs) > 0 {
		metadata = map[string]any{"referenced_investigations": refs}
	}

	// 5. 保存 + 推送用户消息
	userRow, err := core.SaveEinoMessageWithMetadata(d.DB, conv.ID, schema.UserMessage(req.Message), metadata)
	if err != nil {
		_ = emit("error", gin.H{"error": "save user message: " + err.Error()})
		return
	}
	if err := emit("message", userRow); err != nil {
		return // 客户端断开,放弃继续
	}

	// 首条用户消息时自动填充标题。
	// 这里先用 req.Message 首行做兜底(LLM 失败或极慢时有个东西显示),
	// agentic loop 结束后再异步用 LLM 摘要覆盖成更贴切的短标题。
	titleNeedsSummary := conv.Title == ""
	if titleNeedsSummary {
		fallback := req.Message
		if i := indexNewline(fallback); i >= 0 {
			fallback = fallback[:i]
		}
		_ = core.SetConversationTitle(d.DB, conv.ID, fallback)
	}
	_ = core.TouchConversation(d.DB, conv.ID)

	// 5. 跑 Agentic Loop,每产生一条消息即存 + 推
	// 注入 conversation_id,供 investigation 工具关联到当前对话
	ctx := context.WithValue(c.Request.Context(), tools.ConversationIDKey, conv.ID)
	ctx = context.WithValue(ctx, tools.SSEEmitKey, tools.SSEEmitFunc(emit))
	// 把本轮引用的 investigation 作为上下文前缀注入喂给 LLM 的 user message。
	// 落库的 content 保持原样,前端 UserMessage 通过 metadata 渲染卡片,不受影响。
	augmentedUserMessage := req.Message
	if len(refs) > 0 {
		coreRefs := make([]core.ReferencedInvestigationRef, 0, len(refs))
		for _, r := range refs {
			coreRefs = append(coreRefs, core.ReferencedInvestigationRef{
				ID: r.ID, Title: r.Title, Severity: r.Severity, Status: r.Status,
			})
		}
		augmentedUserMessage = core.BuildReferencedInvestigationsPrefix(coreRefs) + req.Message
	}
	// 注入集群已知服务上下文（如果已扫描过）
	systemPrompt := llm.ChatSystemPrompt + knowledge.BuildServiceContext(d.DB)

	result, runErr := d.Engine.Run(ctx, llm.RunInput{
		SystemPrompt: systemPrompt,
		UserMessage:  augmentedUserMessage,
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
		"conversation_id":  conv.ID,
		"iterations":       result.Iterations,
		"prompt_tokens":    result.PromptTokens,
		"completion_tokens": result.CompletionTokens,
		"total_tokens":     result.TotalTokens,
	})

	// 7. 首轮结束后异步生成更贴切的标题,不阻塞请求返回。
	// 用独立 context,避免请求 ctx 在 SSE 断开时被 cancel。
	if titleNeedsSummary && result != nil && result.Final != nil {
		convID := conv.ID
		userMsg := req.Message
		assistantMsg := result.Final.Content
		go func() {
			bg, cancel := context.WithTimeout(context.Background(), 15*time.Second)
			defer cancel()
			title, err := d.LLM.SummarizeTitle(bg, userMsg, assistantMsg)
			if err != nil {
				log.Printf("chat: summarize title failed for %s: %v", convID, err)
				return
			}
			if err := core.SetConversationTitle(d.DB, convID, title); err != nil {
				log.Printf("chat: set title failed for %s: %v", convID, err)
			}
		}()
	}
}
