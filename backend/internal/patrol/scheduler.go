// Package patrol 管理定时巡检任务的调度和执行。
package patrol

import (
	"context"
	"fmt"
	"log"
	"strings"
	"sync"
	"time"

	"github.com/cloudwego/eino/schema"
	"github.com/robfig/cron/v3"
	"gorm.io/gorm"

	"github.com/lulaide/orca/internal/core"
	"github.com/lulaide/orca/internal/knowledge"
	"github.com/lulaide/orca/internal/llm"
	"github.com/lulaide/orca/internal/notify"
	"github.com/lulaide/orca/internal/tools"
)

// Scheduler 管理定时巡检任务。
type Scheduler struct {
	db     *gorm.DB
	engine *llm.Engine
	notify *notify.Manager
	cron   *cron.Cron
	jobs   map[string]cron.EntryID
	mu     sync.Mutex
}

// NewScheduler 创建巡检调度器。
func NewScheduler(db *gorm.DB, engine *llm.Engine, notifyMgr *notify.Manager) *Scheduler {
	return &Scheduler{
		db:     db,
		engine: engine,
		notify: notifyMgr,
		cron:   cron.New(),
		jobs:   make(map[string]cron.EntryID),
	}
}

// Start 从 DB 加载所有 enabled 的巡检配置并启动 cron。
func (s *Scheduler) Start() {
	s.mu.Lock()
	defer s.mu.Unlock()

	configs, err := core.ListPatrolConfigs(s.db)
	if err != nil {
		log.Printf("Patrol: load configs failed: %v", err)
		return
	}

	for i := range configs {
		cfg := configs[i]
		if !cfg.Enabled {
			continue
		}
		s.addJob(&cfg)
	}

	s.cron.Start()
	log.Printf("Patrol: started with %d jobs", len(s.jobs))
}

// Stop 优雅关闭调度器。
func (s *Scheduler) Stop() {
	s.cron.Stop()
	log.Println("Patrol: stopped")
}

// Reload 重新加载所有巡检配置。
func (s *Scheduler) Reload() {
	s.mu.Lock()
	defer s.mu.Unlock()

	for id, entryID := range s.jobs {
		s.cron.Remove(entryID)
		delete(s.jobs, id)
	}

	configs, err := core.ListPatrolConfigs(s.db)
	if err != nil {
		log.Printf("Patrol: reload configs failed: %v", err)
		return
	}

	for i := range configs {
		cfg := configs[i]
		if !cfg.Enabled {
			continue
		}
		s.addJob(&cfg)
	}

	log.Printf("Patrol: reloaded with %d jobs", len(s.jobs))
}

// RunNow 立即执行一次巡检。
func (s *Scheduler) RunNow(id string) error {
	cfg, err := core.GetPatrolConfig(s.db, id)
	if err != nil || cfg == nil {
		return fmt.Errorf("patrol config not found: %s", id)
	}
	go s.runPatrol(cfg)
	return nil
}

// addJob 注册一个 cron job。
func (s *Scheduler) addJob(cfg *core.PatrolConfig) {
	entryID, err := s.cron.AddFunc(cfg.Schedule, func() {
		latest, err := core.GetPatrolConfig(s.db, cfg.ID)
		if err != nil || latest == nil || !latest.Enabled {
			return
		}
		s.runPatrol(latest)
	})
	if err != nil {
		log.Printf("Patrol: invalid cron schedule %q for %s: %v", cfg.Schedule, cfg.Name, err)
		return
	}
	s.jobs[cfg.ID] = entryID
}

// runPatrol 执行一次巡检：自己跑 Agent Loop，结果存 PatrolRun + 飞书通知。
func (s *Scheduler) runPatrol(cfg *core.PatrolConfig) {
	log.Printf("Patrol: running %s (%s)", cfg.Name, cfg.ID)

	run := &core.PatrolRun{
		PatrolID: cfg.ID,
		Status:   "running",
	}
	core.CreatePatrolRun(s.db, run)
	core.MarkPatrolRun(s.db, cfg.ID)

	start := time.Now()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()

	// 创建 Conversation 存消息，让前端能看到完整处理过程
	var convID string
	if conv, err := core.CreateConversation(s.db, "巡检: "+cfg.Name, "patrol", ""); err != nil {
		log.Printf("Patrol: create conversation failed: %v", err)
	} else {
		convID = conv.ID
	}

	ctx = context.WithValue(ctx, tools.ConversationIDKey, convID)

	systemPrompt := buildPatrolSystemPrompt(cfg) + knowledge.BuildSkillContext(s.db)

	// 存初始 user 消息
	if convID != "" {
		if _, err := core.SaveEinoMessage(s.db, convID, schema.UserMessage(cfg.Prompt)); err != nil {
			log.Printf("Patrol: save user message failed: %v", err)
		}
	}

	result, err := s.engine.Run(ctx, llm.RunInput{
		SystemPrompt: systemPrompt,
		UserMessage:  cfg.Prompt,
		OnMessage: func(m *schema.Message) {
			if m == nil || convID == "" {
				return
			}
			if _, err := core.SaveEinoMessage(s.db, convID, m); err != nil {
				log.Printf("Patrol: save message failed: %v", err)
			}
		},
	})

	duration := int(time.Since(start).Seconds())

	if err != nil {
		log.Printf("Patrol: %s failed: %v", cfg.Name, err)
		core.UpdatePatrolRun(s.db, run.ID, "failed", duration, err.Error())
		s.sendNotification(cfg, "failed", err.Error(), duration)
		return
	}

	summary := ""
	if result != nil && result.Final != nil {
		summary = result.Final.Content
	}

	core.UpdatePatrolRun(s.db, run.ID, "completed", duration, "")
	s.db.Model(&core.PatrolRun{}).Where("id = ?", run.ID).Updates(map[string]any{
		"summary":         summary,
		"conversation_id": convID,
	})

	log.Printf("Patrol: %s completed in %ds (%d iterations, %d tokens)", cfg.Name, duration, result.Iterations, result.TotalTokens)

	s.sendNotification(cfg, "completed", summary, duration)
}

// sendNotification 发送巡检通知（只发摘要）。
func (s *Scheduler) sendNotification(cfg *core.PatrolConfig, status, summary string, duration int) {
	if s.notify == nil {
		return
	}

	// 提取摘要行
	briefSummary := extractSummaryLine(summary)

	var title, color string
	if status == "failed" {
		title = "❌ 巡检失败: " + cfg.Name
		color = "red"
	} else if containsIssue(briefSummary) {
		title = "⚠️ 巡检发现问题: " + cfg.Name
		color = "orange"
	} else {
		title = "✅ 巡检正常: " + cfg.Name
		color = "blue"
	}

	var content string
	if status == "failed" {
		// 失败时显示错误原因
		content = "**原因**: " + summary
		if len(content) > 300 {
			content = content[:300] + "…"
		}
	} else {
		content = briefSummary
		if content == "" {
			content = summary
			if len(content) > 200 {
				content = content[:200] + "…"
			}
		}
	}
	content += fmt.Sprintf("\n\n耗时: %ds", duration)

	go s.notify.SendCard(title, content, color)
}

// extractSummaryLine 从报告中提取 "**摘要**：xxx" 行。
func extractSummaryLine(summary string) string {
	for _, line := range strings.Split(summary, "\n") {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "**摘要**：") {
			return strings.TrimPrefix(line, "**摘要**：")
		}
		if strings.HasPrefix(line, "**摘要**:") {
			return strings.TrimPrefix(line, "**摘要**:")
		}
	}
	return ""
}

// containsIssue 判断巡检摘要是否包含问题。
// 排除否定前缀（"无异常"、"未发现问题"等）。
func containsIssue(summary string) bool {
	// 先检查是否明确表示正常
	normalPhrases := []string{"无异常", "一切正常", "未发现问题", "集群健康", "无问题", "正常运行", "无告警"}
	for _, p := range normalPhrases {
		if strings.Contains(summary, p) {
			return false
		}
	}
	// 再检查是否有问题关键词
	issueKeywords := []string{"问题", "故障", "失败", "不可用", "CrashLoop", "NotReady", "ImagePullBackOff", "Pending", "OOMKilled", "频繁重启", "Investigation"}
	for _, kw := range issueKeywords {
		if strings.Contains(summary, kw) {
			return true
		}
	}
	return false
}

func buildPatrolSystemPrompt(cfg *core.PatrolConfig) string {
	return fmt.Sprintf(`你是 Orca 定时巡检 Agent。当前是**自动巡检**模式，没有用户在线。

## 巡检任务
- 名称: %s
- 严重度: %s

## 你的任务

1. 按照用户给定的巡检指令，使用 K8s 工具主动检查集群状态
2. **创建 Investigation 前先检查是否已有相关调查**：
   - 调用 list_investigations(view="active") 查看当前进行中的调查
   - 如果已有标题或描述相似的调查（同一个服务、同一类问题），**不要重复创建**，而是用 add_investigation_entry 追加发现到已有调查
   - 只有确认是全新的、没有被跟踪的问题时才 create_investigation
3. 一切正常就简短总结，不要创建任何 Investigation
4. **创建 Investigation 后，必须完成以下步骤**：
   - 用 add_investigation_entry(type="discovery") 记录发现
   - 用 add_investigation_entry(type="report") 提交排查报告（根因判断 + 证据 + 影响范围）
   - 调用 update_investigation_status 将状态设为 "explored"
   这会自动触发 Generator Agent 生成修复方案

## Skill 技能系统

下方注入了"已知服务技能"列表。排查时先看有没有相关 skill：
- 有 → 调 read_skill(name) 加载排障手册，按手册排查
- 没有 → 正常排查

## 你绝对不能做的

- ❌ 不要调用 run_command（需要审批，无人值守模式下会卡死）
- ❌ 不要执行写操作（restart/scale/delete 等）
- ❌ 不要调用 submit_solution

## 语言要求
所有输出使用中文。

## 最终输出格式（严格遵守）

最后一段纯文本必须按以下格式输出：

**摘要**：一句话总结（如"集群健康，无异常"或"发现 2 个问题：Orca Pod 镜像拉取失败、authentik-worker 频繁重启"）

**详情**：
（这里写详细的检查结果，用 Markdown 格式）

摘要行必须以"**摘要**："开头，这是飞书通知的内容。`, cfg.Name, cfg.Severity)
}
