package main

import (
	"log"

	"github.com/lulaide/orca/internal/api"
	"github.com/lulaide/orca/internal/config"
	"github.com/lulaide/orca/internal/db"
	"github.com/lulaide/orca/internal/kube"
	"github.com/lulaide/orca/internal/llm"
	"github.com/lulaide/orca/internal/tools"
)

func main() {
	// 1. 配置: 默认值 < config.yaml < 环境变量
	cfg := config.Load("config.yaml")

	// 2. 数据库
	gormDB, err := db.New(cfg.Database.DSN())
	if err != nil {
		log.Fatalf("Database: %v", err)
	}
	if err := db.AutoMigrate(gormDB, &db.Setting{}); err != nil {
		log.Fatalf("Migration: %v", err)
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
	reg := tools.NewRegistry()
	tools.RegisterKubernetesTools(reg)
	log.Printf("Tools: registered %v", reg.Names())

	// 7. Agent Engine
	engine := llm.NewEngine(llmMgr, reg)

	// 8. HTTP Server
	router := api.NewRouter(&api.Deps{
		DB:       gormDB,
		LLM:      llmMgr,
		Kube:     kubeMgr,
		Engine:   engine,
		Registry: reg,
	})

	addr := cfg.Server.Addr()
	log.Printf("Orca starting on %s", addr)
	if err := router.Run(addr); err != nil {
		log.Fatalf("Server: %v", err)
	}
}
