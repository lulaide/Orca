package main

import (
	"context"
	"embed"
	"log"

	"gorm.io/gorm"

	"github.com/lulaide/orca/internal/api"
	"github.com/lulaide/orca/internal/auth"
	"github.com/lulaide/orca/internal/config"
	"github.com/lulaide/orca/internal/core"
	"github.com/lulaide/orca/internal/db"
	"github.com/lulaide/orca/internal/dispatch"
	"github.com/lulaide/orca/internal/kube"
	"github.com/lulaide/orca/internal/llm"
	"github.com/lulaide/orca/internal/mcp"
	"github.com/lulaide/orca/internal/notify"
	"github.com/lulaide/orca/internal/patrol"
	"github.com/lulaide/orca/internal/tools"
	"github.com/lulaide/orca/internal/triggers"
)

// 前端静态文件。构建时 npm run build → 复制到 cmd/orca/dist/。
// 目录为空时（本地开发）前端走 Vite dev server 代理，embed 不影响。
//
//go:embed all:dist
var frontendFS embed.FS

func main() {
	// 1. 配置: 默认值 < config.yaml < 环境变量
	cfg := config.Load("config.yaml")

	// 2. 数据库
	gormDB, err := db.New(cfg.Database.DSN())
	if err != nil {
		log.Fatalf("Database: %v", err)
	}
	if err := db.AutoMigrate(gormDB,
		&db.Setting{},
		&core.Conversation{},
		&core.Message{},
		&core.Investigation{},
		&core.InvestigationEntry{},
		&core.ConversationInvestigation{},
		&core.Event{},
		&core.PluginConfig{},
		&core.MCPConnection{},
		&core.KnowledgePage{},
		&core.Skill{},
		&core.PatrolConfig{},
		&core.PatrolRun{},
		&core.PendingAction{},
		&core.User{},
	); err != nil {
		log.Fatalf("Migration: %v", err)
	}
	// 已有对话如果 type 为空，标记为 chat
	gormDB.Model(&core.Conversation{}).Where("type = '' OR type IS NULL").Update("type", "chat")

	// 清理旧列:Conversation.InvestigationIDs 已被独立 join 表 conversation_investigations 取代
	if gormDB.Migrator().HasColumn(&core.Conversation{}, "investigation_ids") {
		if err := gormDB.Migrator().DropColumn(&core.Conversation{}, "investigation_ids"); err != nil {
			log.Printf("Migration: drop legacy investigation_ids column: %v", err)
		}
	}

	// 3. 从 settings 表加载运行时配置,覆盖 bootstrap 值
	var llmCfg config.LLMConfig = cfg.LLM
	if found, err := db.LoadSetting(gormDB, "llm", &llmCfg); err != nil {
		log.Printf("Settings: failed to load llm: %v", err)
	} else if found {
		log.Println("Settings: llm config loaded from database")
	}

	var kubeCfg struct {
		Content string `json:"content"`
	}
	kubeFromDB := false
	if found, err := db.LoadSetting(gormDB, "kubernetes", &kubeCfg); err != nil {
		log.Printf("Settings: failed to load kubernetes: %v", err)
	} else if found && kubeCfg.Content != "" {
		kubeFromDB = true
	}

	// 4. K8s Manager
	var kubeMgr *kube.Manager
	if kubeFromDB {
		kubeMgr = kube.NewManager("")
		if err := kubeMgr.UseKubeconfigBytes([]byte(kubeCfg.Content)); err != nil {
			log.Printf("K8s: failed to load persisted kubeconfig: %v", err)
		}
	} else {
		kubeMgr = kube.NewManager(cfg.Kubernetes.Kubeconfig)
	}

	// 5. LLM Manager
	llmMgr := llm.NewManager(llmCfg)

	// 6. Tool Registry
	tools.KubeMgr = kubeMgr
	tools.DB = gormDB
	reg := tools.NewRegistry()
	tools.RegisterKubernetesTools(reg)
	tools.RegisterKubernetesWriteTools(reg)
	tools.RegisterBashTool(reg)
	tools.RegisterInvestigationTools(reg)
	tools.RegisterSkillTools(reg)
	tools.RegisterSkillWriteTools(reg)

	// 审批管理器
	tools.ApprovalMgr = tools.NewApprovalManager(gormDB)
	log.Printf("Tools: registered %v", reg.Names())

	// 6.5 MCP Client Manager（外接 MCP Server 的工具）
	mcpMgr := mcp.NewManager(reg, gormDB)
	if err := mcpMgr.LoadAll(context.Background()); err != nil {
		log.Printf("MCP: load connections: %v", err)
	}

	// 7. Agent Engine
	engine := llm.NewEngine(llmMgr, reg)

	// 8. Trigger 插件注册表（编译期注册所有已知插件类型）
	triggerReg := triggers.NewRegistry()
	triggerReg.Register(triggers.UptimeKuma{})
	triggerReg.Register(triggers.AlertManager{})
	triggerReg.Register(triggers.Grafana{})
	triggerReg.Register(triggers.GenericWebhook{})
	log.Printf("Triggers: registered plugins: %v", pluginNames(triggerReg))

	// 9. Event Router：把 Event 分派到后台 Agent Loop
	eventRouter := dispatch.NewEventRouter(gormDB, engine, 0)

	// 10. JWT Secret
	jwtSecret, err := auth.GetOrCreateJWTSecret(gormDB)
	if err != nil {
		log.Fatalf("Auth: %v", err)
	}

	// 11. Notification Manager
	notifyMgr := notify.NewManager(gormDB)
	tools.NotifyMgr = notifyMgr

	// 12. OAuth Manager
	oauthMgr := auth.NewOAuthManager(gormDB)

	// 13. Patrol Scheduler
	patrolScheduler := patrol.NewScheduler(gormDB, engine, notifyMgr)
	seedDefaultPatrol(gormDB)
	patrolScheduler.Start()
	defer patrolScheduler.Stop()

	// 14. HTTP Server
	router := api.NewRouter(&api.Deps{
		FrontendFS: frontendFS,
		DB:       gormDB,
		LLM:      llmMgr,
		Kube:     kubeMgr,
		Engine:   engine,
		Registry: reg,
		Triggers: triggerReg,
		Router:   eventRouter,
		MCP:       mcpMgr,
		JWTSecret: jwtSecret,
		OAuth:     oauthMgr,
		Notify:    notifyMgr,
		Patrol:    patrolScheduler,
	})

	addr := cfg.Server.Addr()
	log.Printf("Orca starting on %s", addr)
	if err := router.Run(addr); err != nil {
		log.Fatalf("Server: %v", err)
	}
}

func pluginNames(r *triggers.Registry) []string {
	all := r.All()
	names := make([]string, 0, len(all))
	for _, p := range all {
		names = append(names, p.Name())
	}
	return names
}

// seedDefaultPatrol 首次启动时创建默认巡检任务。
func seedDefaultPatrol(gormDB *gorm.DB) {
	var count int64
	gormDB.Model(&core.PatrolConfig{}).Count(&count)
	if count > 0 {
		return
	}
	cfg := &core.PatrolConfig{
		Name:     "集群健康检查",
		Schedule: "0 */6 * * *",
		Severity: "warning",
		Enabled:  true,
		Prompt: `检查集群整体健康状态：
1. 所有节点是否 Ready，资源使用是否接近上限
2. 是否有 Pod 处于 CrashLoopBackOff、ImagePullBackOff 或 Pending 状态
3. 是否有频繁重启的 Pod（最近 1 小时重启 > 3 次）
4. 是否有 Event 中的异常警告
如果发现问题，创建 Investigation 记录。一切正常则简短总结。`,
	}
	if err := core.CreatePatrolConfig(gormDB, cfg); err != nil {
		log.Printf("Patrol: seed default failed: %v", err)
	} else {
		log.Printf("Patrol: created default patrol %q", cfg.Name)
	}
}
