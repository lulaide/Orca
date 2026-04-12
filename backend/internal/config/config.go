package config

import (
	"fmt"
	"os"
	"strconv"

	"gopkg.in/yaml.v3"
)

type Config struct {
	Server     ServerConfig     `yaml:"server"`
	Database   DatabaseConfig   `yaml:"database"`
	LLM        LLMConfig        `yaml:"llm"`
	Kubernetes KubernetesConfig `yaml:"kubernetes"`
}

type ServerConfig struct {
	Host string `yaml:"host"`
	Port int    `yaml:"port"`
}

type DatabaseConfig struct {
	Host     string `yaml:"host"`
	Port     int    `yaml:"port"`
	Name     string `yaml:"name"`
	User     string `yaml:"user"`
	Password string `yaml:"password"`
	SSLMode  string `yaml:"sslmode"`
}

type LLMConfig struct {
	Provider      string `yaml:"provider"       json:"provider"`
	Endpoint      string `yaml:"endpoint"       json:"endpoint,omitempty"`
	APIKey        string `yaml:"api_key"        json:"api_key"`
	Model         string `yaml:"model"          json:"model"`
	MaxIterations int    `yaml:"max_iterations" json:"max_iterations,omitempty"`
}

type KubernetesConfig struct {
	Kubeconfig string `yaml:"kubeconfig"`
}

// Load 加载配置。优先级: 默认值 < config.yaml < 环境变量。
// config.yaml 不存在时不报错,直接用默认值 + 环境变量。
func Load(path string) *Config {
	cfg := defaultConfig()

	if data, err := os.ReadFile(path); err == nil {
		_ = yaml.Unmarshal(data, cfg)
	}

	applyEnvOverrides(cfg)
	return cfg
}

// defaultConfig 返回合理的默认配置。
// 没有 config.yaml 时靠这些默认值 + 环境变量就能启动。
func defaultConfig() *Config {
	return &Config{
		Server: ServerConfig{
			Host: "0.0.0.0",
			Port: 8080,
		},
		Database: DatabaseConfig{
			Host:    "localhost",
			Port:    5432,
			Name:    "orca",
			User:    "orca",
			Password: "orca",
			SSLMode: "disable",
		},
		LLM: LLMConfig{
			MaxIterations: 10,
		},
	}
}

// DSN 返回 PostgreSQL 连接字符串。
func (d *DatabaseConfig) DSN() string {
	return fmt.Sprintf(
		"host=%s port=%d user=%s password=%s dbname=%s sslmode=%s",
		d.Host, d.Port, d.User, d.Password, d.Name, d.SSLMode,
	)
}

// Addr 返回 HTTP 监听地址。
func (s *ServerConfig) Addr() string {
	return fmt.Sprintf("%s:%d", s.Host, s.Port)
}

// applyEnvOverrides 用环境变量覆盖 YAML 中的值，环境变量优先级更高。
func applyEnvOverrides(cfg *Config) {
	if v := os.Getenv("HTTP_HOST"); v != "" {
		cfg.Server.Host = v
	}
	if v := os.Getenv("HTTP_PORT"); v != "" {
		if port, err := strconv.Atoi(v); err == nil {
			cfg.Server.Port = port
		}
	}

	if v := os.Getenv("DB_HOST"); v != "" {
		cfg.Database.Host = v
	}
	if v := os.Getenv("DB_PORT"); v != "" {
		if port, err := strconv.Atoi(v); err == nil {
			cfg.Database.Port = port
		}
	}
	if v := os.Getenv("DB_NAME"); v != "" {
		cfg.Database.Name = v
	}
	if v := os.Getenv("DB_USER"); v != "" {
		cfg.Database.User = v
	}
	if v := os.Getenv("DB_PASSWORD"); v != "" {
		cfg.Database.Password = v
	}

	if v := os.Getenv("LLM_PROVIDER"); v != "" {
		cfg.LLM.Provider = v
	}
	if v := os.Getenv("LLM_ENDPOINT"); v != "" {
		cfg.LLM.Endpoint = v
	}
	if v := os.Getenv("LLM_API_KEY"); v != "" {
		cfg.LLM.APIKey = v
	}
	if v := os.Getenv("LLM_MODEL"); v != "" {
		cfg.LLM.Model = v
	}
	if v := os.Getenv("LLM_MAX_ITERATIONS"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			cfg.LLM.MaxIterations = n
		}
	}

	if v := os.Getenv("KUBECONFIG"); v != "" && cfg.Kubernetes.Kubeconfig == "" {
		cfg.Kubernetes.Kubeconfig = v
	}
}
