package llm

import (
	"context"
	"testing"
	"time"

	"github.com/lulaide/orca/internal/config"
	"github.com/lulaide/orca/internal/kube"
	"github.com/lulaide/orca/internal/tools"
)

// TestAgenticLoopWithKubernetes 端到端验证:
//   - 加载 config.yaml
//   - 初始化 kube.Manager(in-cluster 或 ~/.kube/config)
//   - 注册 get_pods 工具
//   - 让 LLM 通过 Function Calling 调用 get_pods 并给出结论
//
// 需要:
//   - config.yaml 里 llm.api_key 非空
//   - 本机有可用的 K8s 集群(kubeconfig 或 in-cluster)
//
// 运行: cd backend && go test -v -run TestAgenticLoopWithKubernetes ./internal/llm
func TestAgenticLoopWithKubernetes(t *testing.T) {
	cfg := config.Load("../../config.yaml")
	if cfg.LLM.APIKey == "" {
		t.Skip("llm.api_key not set in config.yaml, skipping")
	}

	// 1. K8s
	// 从 config 读 kubeconfig(config 会读 KUBECONFIG 环境变量覆盖)。
	// 本地测试前设环境变量: export KUBECONFIG=~/.kube/config
	kubeMgr := kube.NewManager(cfg.Kubernetes.Kubeconfig)
	kubeStatus := kubeMgr.Status()
	t.Logf("k8s: mode=%s connected=%v", kubeStatus.Mode, kubeStatus.Connected)
	if !kubeStatus.Connected {
		t.Skipf("kubernetes not available: %s", kubeStatus.LastError)
	}
	t.Logf("k8s server: %s", kubeStatus.ServerVer)

	// 2. Tool Registry + K8s tools
	tools.KubeMgr = kubeMgr
	reg := tools.NewRegistry()
	tools.RegisterKubernetesTools(reg)
	t.Logf("registered tools: %v", reg.Names())

	// 3. LLM Manager + Engine
	llmMgr := NewManager(cfg.LLM)
	if !llmMgr.Status().Configured {
		t.Fatalf("llm not configured: %s", llmMgr.Status().LastError)
	}
	engine := NewEngine(llmMgr, reg)

	// 4. Run
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	result, err := engine.Run(ctx, RunInput{
		SystemPrompt: "You are an SRE assistant operating on a Kubernetes cluster. " +
			"Use the available tools to answer questions. Be concise.",
		UserMessage: "List all pods in the kube-system namespace and tell me how many there are, " +
			"and whether any are not Running.",
	})
	if err != nil {
		t.Fatalf("engine run: %v", err)
	}

	t.Logf("iterations used: %d", result.Iterations)
	t.Logf("messages added this run: %d", len(result.Messages))
	t.Logf("=== FINAL ANSWER ===\n%s", result.Final.Content)

	if result.Final.Content == "" {
		t.Error("final answer is empty")
	}
}
