package tools

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/cloudwego/eino/schema"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/lulaide/orca/internal/kube"
)

// KubeMgr 全局 K8s Manager,由 main.go 启动时赋值。
// tools 包内所有 K8s 工具的 handler 直接读这个变量拿最新的 Clientset。
var KubeMgr *kube.Manager

// RegisterKubernetesTools 把 K8s 只读工具全部注册到 registry。
// 调用前必须先设置 KubeMgr。
func RegisterKubernetesTools(reg *Registry) {
	reg.Register(getPodsInfo(), handleGetPods)
}

// ---- get_pods ----

type getPodsArgs struct {
	Namespace string `json:"namespace"`
}

func getPodsInfo() *schema.ToolInfo {
	return &schema.ToolInfo{
		Name: "get_pods",
		Desc: "List Kubernetes Pods in a namespace. If namespace is empty, lists pods across all namespaces. Returns pod name, namespace, status phase, ready count, restart count, and age.",
		ParamsOneOf: schema.NewParamsOneOfByParams(map[string]*schema.ParameterInfo{
			"namespace": {
				Type:     schema.String,
				Desc:     "Kubernetes namespace name. Empty string means all namespaces.",
				Required: false,
			},
		}),
	}
}

func handleGetPods(ctx context.Context, args string) (string, error) {
	var a getPodsArgs
	if args != "" {
		if err := json.Unmarshal([]byte(args), &a); err != nil {
			return "", fmt.Errorf("invalid args: %w", err)
		}
	}

	cs := KubeMgr.Clientset()
	if cs == nil {
		return "", errors.New("kubernetes is not configured; ask the operator to configure it in the backend")
	}

	pods, err := cs.CoreV1().Pods(a.Namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return "", fmt.Errorf("list pods: %w", err)
	}

	return formatPodList(pods.Items), nil
}

// formatPodList 把 Pod 列表格式化成 LLM 友好的紧凑文本。
// 不用 JSON 是因为大量重复字段会浪费 token,这种表格式更经济。
func formatPodList(pods []corev1.Pod) string {
	if len(pods) == 0 {
		return "No pods found."
	}
	var b strings.Builder
	fmt.Fprintf(&b, "Found %d pod(s):\n", len(pods))
	fmt.Fprintln(&b, "NAMESPACE\tNAME\tSTATUS\tREADY\tRESTARTS\tNODE")
	for _, p := range pods {
		ready, total := podReadyCount(&p)
		restarts := podRestartCount(&p)
		fmt.Fprintf(&b, "%s\t%s\t%s\t%d/%d\t%d\t%s\n",
			p.Namespace,
			p.Name,
			p.Status.Phase,
			ready, total,
			restarts,
			p.Spec.NodeName,
		)
	}
	return b.String()
}

func podReadyCount(p *corev1.Pod) (int, int) {
	total := len(p.Status.ContainerStatuses)
	ready := 0
	for _, cs := range p.Status.ContainerStatuses {
		if cs.Ready {
			ready++
		}
	}
	return ready, total
}

func podRestartCount(p *corev1.Pod) int32 {
	var total int32
	for _, cs := range p.Status.ContainerStatuses {
		total += cs.RestartCount
	}
	return total
}
