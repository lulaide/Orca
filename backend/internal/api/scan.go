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

const scanSystemPrompt = `你是 Orca 的知识库 Agent。你的任务是探索 Kubernetes 集群，为每个服务生成 **Skill（技能）**。

## Skill 是什么

Skill 是排查 Agent 的记忆单元。当告警触发时，排查 Agent 会看到所有 skill 的 name + description，
决定哪些和当前问题相关，然后调用 read_skill(name) 加载详情。

所以 description 是 **触发器**——写得不好，排查 Agent 就找不到这个 skill，等于白写。
content 是 **排障手册**——排查 Agent 加载后照着做，写得越实用排查越快。

## 工作流程

1. 查看下方"已知服务技能"列表，了解已有哪些 skill（如果有的话）
   - 已有的 skill：用 read_skill(name) 读取当前内容，对比集群实际状态决定是否需要更新
   - 新发现的服务：创建新 skill
   - 已消失的服务：用 delete_skill 删除
2. 用 get_pods（所有 namespace）获取完整工作负载列表
3. 用 describe_resource 查看每个服务的配置细节
4. 自主决定创建/更新哪些 Skill：
   - 一个业务服务 → 一个 Skill
   - 紧密关联的组件（如 server + worker + db）→ 合并一个
   - 系统基础设施 → 觉得有必要就汇总一个
4. 复杂服务补充 reference 文件（write_skill_ref）

## description 怎么写（最重要）

description 决定排查 Agent 能不能找到这个 skill。要写得"主动"——不只描述服务是什么，
更要列出 **所有可能触发的场景**。Agent 倾向于"不够积极"地使用 skill，所以 description 要推一把。

**差的 description**（太泛，Agent 不知道什么时候该用）：
> Authentik 是一个身份认证服务。

**好的 description**（列出触发场景，Agent 容易匹配）：
> Authentik 身份认证平台，提供 SSO、OAuth2、SAML。当调查涉及登录失败、OAuth 回调错误、
> SSO 不可用、auth 域名无法访问、认证相关 401/403 错误、用户无法登录任何依赖 Authentik 的服务
> （如 Gitea、Orca）时，务必使用此技能。

**原则**：
- 第一句说清楚服务是什么
- 后面列出所有相关的故障场景、关键词、域名、依赖它的服务
- 用"当...时使用此技能"或"涉及...时务必参考"这种触发句式
- 宁可多列场景，不要遗漏——误触发比漏触发好

## content 怎么写

content 是排查 Agent 加载后看到的内容。按对排查的实用性排序：

1. **排障手册**（最重要）：常见故障场景 + 排查步骤
   - 想象你是运维，半夜被叫起来，最需要什么信息
   - 每个场景写清楚：现象 → 检查什么 → 可能原因 → 解决方法
2. **组件清单**：Deployment/StatefulSet，镜像、端口、关键环境变量
3. **依赖关系**：依赖什么、被什么依赖（排查时要跟踪上下游）
4. **对外暴露**：域名、Ingress、Service
5. **注意事项**：配置要点、升级注意等

控制在 5000 tokens 以内。详细的架构图、历史事件等拆到 reference。

## write_skill_ref（按需）

复杂服务才写。文件名自己定：
- architecture.md：Mermaid 架构图 + 组件交互（用 ` + "```mermaid" + ` 代码块）
- 其他按实际需要

简单服务不需要任何 reference。

## 内容原则

- **全部中文**，Markdown 格式
- 专注于"是什么、干什么、怎么排查"，**禁止写运行状态**
- 简单服务几行就够，不要凑字数
- description 要"主动推荐"，content 要"实用导向"

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
			SystemPrompt: scanSystemPrompt + knowledge.BuildSkillContext(d.DB),
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
