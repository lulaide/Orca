package main

import (
	"context"
	"log"

	"github.com/lulaide/orca/internal/api"
	"github.com/lulaide/orca/internal/config"
	"github.com/lulaide/orca/internal/core"
	"github.com/lulaide/orca/internal/db"
	"github.com/lulaide/orca/internal/dispatch"
	"github.com/lulaide/orca/internal/kube"
	"github.com/lulaide/orca/internal/llm"
	"github.com/lulaide/orca/internal/mcp"
	"github.com/lulaide/orca/internal/tools"
	"github.com/lulaide/orca/internal/triggers"
)

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
	); err != nil {
		log.Fatalf("Migration: %v", err)
	}
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
	tools.RegisterInvestigationTools(reg)
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
	log.Printf("Triggers: registered plugins: %v", pluginNames(triggerReg))

	// 9. Event Router：把 Event 分派到后台 Agent Loop
	eventRouter := dispatch.NewEventRouter(gormDB, engine, 0)

	// 10. HTTP Server
	router := api.NewRouter(&api.Deps{
		DB:       gormDB,
		LLM:      llmMgr,
		Kube:     kubeMgr,
		Engine:   engine,
		Registry: reg,
		Triggers: triggerReg,
		Router:   eventRouter,
		MCP:      mcpMgr,
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
