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

var globalScan scanState

func (s *scanState) start() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.running {
		return false
	}
	s.running = true
	s.done = false
	s.messages = nil
	s.subs = nil
	return true
}

func (s *scanState) push(event string, data any) {
	s.mu.Lock()
	defer s.mu.Unlock()

	frame := sseFrame{Event: event, Data: data}
	raw, _ := json.Marshal(frame)
	s.messages = append(s.messages, raw)

	if event == "done" || event == "error" {
		s.done = true
		s.running = false
	}

	for _, ch := range s.subs {
		select {
		case ch <- struct{}{}:
		default:
		}
	}
}

func (s *scanState) subscribe() (<-chan struct{}, func()) {
	s.mu.Lock()
	defer s.mu.Unlock()
	ch := make(chan struct{}, 1)
	s.subs = append(s.subs, ch)
	return ch, func() {
		s.mu.Lock()
		defer s.mu.Unlock()
		for i, c := range s.subs {
			if c == ch {
				s.subs = append(s.subs[:i], s.subs[i+1:]...)
				break
			}
		}
	}
}

func (s *scanState) snapshot() (msgs []json.RawMessage, isDone bool, isRunning bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	msgs = append([]json.RawMessage{}, s.messages...)
	return msgs, s.done, s.running
}

const scanSystemPrompt = `你是 Orca 的知识库 Agent。你的任务是探索 Kubernetes 集群，为每个服务生成结构化的 **Skill（技能）** 文档。

## 什么是 Skill

Skill 是 Agent 对一个服务的全部认知——包括它是什么、怎么部署的、依赖什么、出问题怎么排查。
Skill 不仅给人看，更是其他 Agent 排查问题时的参考依据。写得越好，排查越快。

## 工作流程

1. **探索集群全貌**：用 get_pods（所有 namespace）获取完整的工作负载列表
2. **深入了解每个服务**：用 describe_resource 查看配置细节（镜像、端口、挂载、环境变量等）
3. **自主决定要创建哪些 Skill**：
   - 一个独立的业务服务 → 一个 Skill
   - 多个紧密关联的组件（如 server + worker + db）→ 合并为一个 Skill
   - 系统基础设施（DNS/CNI/存储等）→ 你觉得有必要就汇总一个，不需要就跳过
   - 想写集群概述就写，不想写也行
4. **为复杂服务补充 reference 文件**：调用 write_skill_ref（按需）

## Skill 内容要求

### write_skill 参数

- **name**: 小写短横线，如 "authentik"、"gitea"、"cluster-overview"
- **description**: 一句话（<150 字），写清楚这个服务是什么、什么场景下排查时该参考这个 skill
- **content**: SKILL.md body，核心文档，包含：
  - 概述：服务用途和集群中的角色
  - 组件：Deployment/StatefulSet 列表，镜像、端口
  - 对外暴露：域名、Ingress
  - 依赖关系：依赖什么、被什么依赖
  - 排障手册：常见问题的排查步骤（根据你对服务架构的理解推断）
  - 注意事项：配置要点、升级注意等

### write_skill_ref 参数（按需，复杂服务才写）

- **architecture.md**: Mermaid 图 + 组件交互说明（推荐用 ` + "```mermaid" + ` 代码块）
- 其他自定义 reference：文件名自己定，按实际需要

## 内容原则

- **全部中文**，Markdown 格式
- 专注于"是什么、干什么、怎么排查"，**不写运行状态**（Pod 是否 Running、Ready 数等）
- 简单服务不要凑字数，几行就够；复杂服务才写 reference
- Mermaid 图用 ` + "```mermaid" + ` 代码块
- 排障手册是重点——想象你是运维，半夜被叫起来查这个服务的问题，最需要什么信息

## 输出

最后用中文简短总结：生成了多少个 Skill、覆盖了哪些服务。`

// handleScanCluster 启动一次后台知识库扫描。
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
			UserMessage:  "请开始探索集群并生成 Skill 技能文档。",
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

	for _, m := range msgs {
		select {
		case <-clientGone:
			return
		default:
		}
		emitRaw(m)
	}

	if isDone {
		return
	}

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
