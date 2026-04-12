package tools

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"
	"time"

	"github.com/cloudwego/eino/schema"
	appsv1 "k8s.io/api/apps/v1"
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
	reg.Register(getPodLogsInfo(), handleGetPodLogs)
	reg.Register(describeResourceInfo(), handleDescribeResource)
	reg.Register(getEventsInfo(), handleGetEvents)
	reg.Register(getNodeStatusInfo(), handleGetNodeStatus)
}

// clientset 返回当前活动的 K8s 客户端,未配置时返回错误。
func clientset() (*kube.Manager, error) {
	if KubeMgr == nil || KubeMgr.Clientset() == nil {
		return nil, errors.New("kubernetes is not configured; ask the operator to configure it in the backend")
	}
	return KubeMgr, nil
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

	mgr, err := clientset()
	if err != nil {
		return "", err
	}

	pods, err := mgr.Clientset().CoreV1().Pods(a.Namespace).List(ctx, metav1.ListOptions{})
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

// ---- get_pod_logs ----

type getPodLogsArgs struct {
	Namespace string `json:"namespace"`
	Name      string `json:"name"`
	Container string `json:"container"`
	TailLines int64  `json:"tail_lines"`
}

func getPodLogsInfo() *schema.ToolInfo {
	return &schema.ToolInfo{
		Name: "get_pod_logs",
		Desc: "Get logs from a specific Pod. Returns the last N lines of log output. Useful for diagnosing crashes, errors, or unexpected behavior.",
		ParamsOneOf: schema.NewParamsOneOfByParams(map[string]*schema.ParameterInfo{
			"namespace": {
				Type:     schema.String,
				Desc:     "Namespace of the Pod.",
				Required: true,
			},
			"name": {
				Type:     schema.String,
				Desc:     "Name of the Pod.",
				Required: true,
			},
			"container": {
				Type:     schema.String,
				Desc:     "Container name. Required only for multi-container Pods.",
				Required: false,
			},
			"tail_lines": {
				Type:     schema.Integer,
				Desc:     "Number of lines from the end to return. Defaults to 100.",
				Required: false,
			},
		}),
	}
}

func handleGetPodLogs(ctx context.Context, args string) (string, error) {
	var a getPodLogsArgs
	if err := json.Unmarshal([]byte(args), &a); err != nil {
		return "", fmt.Errorf("invalid args: %w", err)
	}
	if a.Name == "" {
		return "", errors.New("'name' is required")
	}
	if a.Namespace == "" {
		a.Namespace = "default"
	}
	if a.TailLines <= 0 {
		a.TailLines = 100
	}

	mgr, err := clientset()
	if err != nil {
		return "", err
	}

	opts := &corev1.PodLogOptions{
		TailLines: &a.TailLines,
	}
	if a.Container != "" {
		opts.Container = a.Container
	}

	stream, err := mgr.Clientset().CoreV1().Pods(a.Namespace).GetLogs(a.Name, opts).Stream(ctx)
	if err != nil {
		return "", fmt.Errorf("get logs: %w", err)
	}
	defer stream.Close()

	var buf bytes.Buffer
	// 截断到 10KB,避免撑爆 LLM context
	limited := io.LimitReader(stream, 10*1024)
	if _, err := io.Copy(&buf, limited); err != nil {
		return "", fmt.Errorf("read logs: %w", err)
	}

	if buf.Len() == 0 {
		return "No logs found.", nil
	}
	return buf.String(), nil
}

// ---- describe_resource ----

type describeResourceArgs struct {
	Kind      string `json:"kind"`
	Namespace string `json:"namespace"`
	Name      string `json:"name"`
}

func describeResourceInfo() *schema.ToolInfo {
	return &schema.ToolInfo{
		Name: "describe_resource",
		Desc: "Get detailed information about a Kubernetes resource. Supports: pod, deployment, service, node, ingress, statefulset, daemonset, job, cronjob, pvc.",
		ParamsOneOf: schema.NewParamsOneOfByParams(map[string]*schema.ParameterInfo{
			"kind": {
				Type:     schema.String,
				Desc:     "Resource kind: pod, deployment, service, node, ingress, statefulset, daemonset, job, cronjob, pvc.",
				Required: true,
				Enum:     []string{"pod", "deployment", "service", "node", "ingress", "statefulset", "daemonset", "job", "cronjob", "pvc"},
			},
			"namespace": {
				Type:     schema.String,
				Desc:     "Namespace of the resource. Not needed for cluster-scoped resources like node.",
				Required: false,
			},
			"name": {
				Type:     schema.String,
				Desc:     "Name of the resource.",
				Required: true,
			},
		}),
	}
}

func handleDescribeResource(ctx context.Context, args string) (string, error) {
	var a describeResourceArgs
	if err := json.Unmarshal([]byte(args), &a); err != nil {
		return "", fmt.Errorf("invalid args: %w", err)
	}
	if a.Name == "" {
		return "", errors.New("'name' is required")
	}
	if a.Namespace == "" {
		a.Namespace = "default"
	}

	mgr, err := clientset()
	if err != nil {
		return "", err
	}
	cs := mgr.Clientset()
	get := metav1.GetOptions{}

	switch strings.ToLower(a.Kind) {
	case "pod":
		obj, err := cs.CoreV1().Pods(a.Namespace).Get(ctx, a.Name, get)
		if err != nil {
			return "", err
		}
		return formatPodDetail(obj), nil

	case "deployment":
		obj, err := cs.AppsV1().Deployments(a.Namespace).Get(ctx, a.Name, get)
		if err != nil {
			return "", err
		}
		return formatJSON("Deployment", obj.Name, obj.Namespace, map[string]any{
			"replicas":           fmt.Sprintf("%d/%d ready", obj.Status.ReadyReplicas, *obj.Spec.Replicas),
			"strategy":           string(obj.Spec.Strategy.Type),
			"image":              obj.Spec.Template.Spec.Containers[0].Image,
			"conditions":         formatDeployConditions(obj.Status.Conditions),

			"creation_timestamp": obj.CreationTimestamp.Format(time.RFC3339),
		}), nil

	case "service":
		obj, err := cs.CoreV1().Services(a.Namespace).Get(ctx, a.Name, get)
		if err != nil {
			return "", err
		}
		ports := make([]string, 0, len(obj.Spec.Ports))
		for _, p := range obj.Spec.Ports {
			ports = append(ports, fmt.Sprintf("%s:%d→%d", p.Protocol, p.Port, p.TargetPort.IntValue()))
		}
		return formatJSON("Service", obj.Name, obj.Namespace, map[string]any{
			"type":       string(obj.Spec.Type),
			"cluster_ip": obj.Spec.ClusterIP,
			"ports":      ports,
			"selector":   obj.Spec.Selector,
		}), nil

	case "node":
		obj, err := cs.CoreV1().Nodes().Get(ctx, a.Name, get)
		if err != nil {
			return "", err
		}
		return formatNodeDetail(obj), nil

	case "ingress":
		obj, err := cs.NetworkingV1().Ingresses(a.Namespace).Get(ctx, a.Name, get)
		if err != nil {
			return "", err
		}
		rules := make([]string, 0)
		for _, r := range obj.Spec.Rules {
			host := r.Host
			for _, p := range r.HTTP.Paths {
				rules = append(rules, fmt.Sprintf("%s%s → %s:%d", host, p.Path, p.Backend.Service.Name, p.Backend.Service.Port.Number))
			}
		}
		return formatJSON("Ingress", obj.Name, obj.Namespace, map[string]any{
			"rules": rules,
		}), nil

	case "statefulset":
		obj, err := cs.AppsV1().StatefulSets(a.Namespace).Get(ctx, a.Name, get)
		if err != nil {
			return "", err
		}
		return formatJSON("StatefulSet", obj.Name, obj.Namespace, map[string]any{
			"replicas": fmt.Sprintf("%d/%d ready", obj.Status.ReadyReplicas, *obj.Spec.Replicas),
			"image":    obj.Spec.Template.Spec.Containers[0].Image,
		}), nil

	case "daemonset":
		obj, err := cs.AppsV1().DaemonSets(a.Namespace).Get(ctx, a.Name, get)
		if err != nil {
			return "", err
		}
		return formatJSON("DaemonSet", obj.Name, obj.Namespace, map[string]any{
			"desired":   obj.Status.DesiredNumberScheduled,
			"ready":     obj.Status.NumberReady,
			"available": obj.Status.NumberAvailable,
			"image":     obj.Spec.Template.Spec.Containers[0].Image,
		}), nil

	case "job":
		obj, err := cs.BatchV1().Jobs(a.Namespace).Get(ctx, a.Name, get)
		if err != nil {
			return "", err
		}
		return formatJSON("Job", obj.Name, obj.Namespace, map[string]any{
			"active":    obj.Status.Active,
			"succeeded": obj.Status.Succeeded,
			"failed":    obj.Status.Failed,
		}), nil

	case "cronjob":
		obj, err := cs.BatchV1().CronJobs(a.Namespace).Get(ctx, a.Name, get)
		if err != nil {
			return "", err
		}
		lastSchedule := "never"
		if obj.Status.LastScheduleTime != nil {
			lastSchedule = obj.Status.LastScheduleTime.Format(time.RFC3339)
		}
		return formatJSON("CronJob", obj.Name, obj.Namespace, map[string]any{
			"schedule":      obj.Spec.Schedule,
			"suspended":     *obj.Spec.Suspend,
			"active_jobs":   len(obj.Status.Active),
			"last_schedule": lastSchedule,
		}), nil

	case "pvc":
		obj, err := cs.CoreV1().PersistentVolumeClaims(a.Namespace).Get(ctx, a.Name, get)
		if err != nil {
			return "", err
		}
		storage := ""
		if req, ok := obj.Spec.Resources.Requests[corev1.ResourceStorage]; ok {
			storage = req.String()
		}
		return formatJSON("PVC", obj.Name, obj.Namespace, map[string]any{
			"status":        string(obj.Status.Phase),
			"storage_class": strPtr(obj.Spec.StorageClassName),
			"capacity":      storage,
			"access_modes":  obj.Spec.AccessModes,
			"volume_name":   obj.Spec.VolumeName,
		}), nil

	default:
		return "", fmt.Errorf("unsupported kind: %q", a.Kind)
	}
}

// ---- get_events ----

type getEventsArgs struct {
	Namespace string `json:"namespace"`
	Limit     int    `json:"limit"`
}

func getEventsInfo() *schema.ToolInfo {
	return &schema.ToolInfo{
		Name: "get_events",
		Desc: "List recent Kubernetes events. Useful for spotting scheduling failures, image pull errors, OOM kills, probe failures, and other cluster issues.",
		ParamsOneOf: schema.NewParamsOneOfByParams(map[string]*schema.ParameterInfo{
			"namespace": {
				Type:     schema.String,
				Desc:     "Namespace to filter events. Empty means all namespaces.",
				Required: false,
			},
			"limit": {
				Type:     schema.Integer,
				Desc:     "Maximum number of events to return. Defaults to 50.",
				Required: false,
			},
		}),
	}
}

func handleGetEvents(ctx context.Context, args string) (string, error) {
	var a getEventsArgs
	if args != "" {
		if err := json.Unmarshal([]byte(args), &a); err != nil {
			return "", fmt.Errorf("invalid args: %w", err)
		}
	}
	if a.Limit <= 0 {
		a.Limit = 50
	}

	mgr, err := clientset()
	if err != nil {
		return "", err
	}

	events, err := mgr.Clientset().CoreV1().Events(a.Namespace).List(ctx, metav1.ListOptions{
		Limit: int64(a.Limit),
	})
	if err != nil {
		return "", fmt.Errorf("list events: %w", err)
	}

	if len(events.Items) == 0 {
		return "No events found.", nil
	}

	var b strings.Builder
	fmt.Fprintf(&b, "Found %d event(s):\n", len(events.Items))
	fmt.Fprintln(&b, "LAST SEEN\tTYPE\tREASON\tOBJECT\tMESSAGE")
	for _, e := range events.Items {
		lastSeen := e.LastTimestamp.Format("15:04:05")
		if e.LastTimestamp.IsZero() && e.EventTime.Time != (time.Time{}) {
			lastSeen = e.EventTime.Format("15:04:05")
		}
		object := fmt.Sprintf("%s/%s", strings.ToLower(e.InvolvedObject.Kind), e.InvolvedObject.Name)
		msg := e.Message
		if len(msg) > 120 {
			msg = msg[:120] + "..."
		}
		fmt.Fprintf(&b, "%s\t%s\t%s\t%s\t%s\n", lastSeen, e.Type, e.Reason, object, msg)
	}
	return b.String(), nil
}

// ---- get_node_status ----

func getNodeStatusInfo() *schema.ToolInfo {
	return &schema.ToolInfo{
		Name: "get_node_status",
		Desc: "List all Kubernetes nodes with their status, roles, version, and resource capacity. Useful for checking node health and capacity.",
		ParamsOneOf: schema.NewParamsOneOfByParams(map[string]*schema.ParameterInfo{}),
	}
}

func handleGetNodeStatus(ctx context.Context, args string) (string, error) {
	mgr, err := clientset()
	if err != nil {
		return "", err
	}

	nodes, err := mgr.Clientset().CoreV1().Nodes().List(ctx, metav1.ListOptions{})
	if err != nil {
		return "", fmt.Errorf("list nodes: %w", err)
	}

	if len(nodes.Items) == 0 {
		return "No nodes found.", nil
	}

	var b strings.Builder
	fmt.Fprintf(&b, "Found %d node(s):\n", len(nodes.Items))
	for _, n := range nodes.Items {
		b.WriteString(formatNodeDetail(&n))
		b.WriteString("\n---\n")
	}
	return b.String(), nil
}

// ---- 格式化辅助函数 ----

func formatPodDetail(p *corev1.Pod) string {
	var b strings.Builder
	ready, total := podReadyCount(p)
	restarts := podRestartCount(p)
	fmt.Fprintf(&b, "Pod: %s/%s\n", p.Namespace, p.Name)
	fmt.Fprintf(&b, "Status: %s  Ready: %d/%d  Restarts: %d  Node: %s\n",
		p.Status.Phase, ready, total, restarts, p.Spec.NodeName)

	for _, cs := range p.Status.ContainerStatuses {
		state := "unknown"
		detail := ""
		if cs.State.Running != nil {
			state = "running"
		} else if cs.State.Waiting != nil {
			state = "waiting"
			detail = fmt.Sprintf(" (%s: %s)", cs.State.Waiting.Reason, cs.State.Waiting.Message)
		} else if cs.State.Terminated != nil {
			state = "terminated"
			detail = fmt.Sprintf(" (%s: exit %d)", cs.State.Terminated.Reason, cs.State.Terminated.ExitCode)
		}
		fmt.Fprintf(&b, "  Container %s: %s%s  image=%s  restarts=%d\n",
			cs.Name, state, detail, cs.Image, cs.RestartCount)
	}

	if len(p.Status.Conditions) > 0 {
		b.WriteString("Conditions: ")
		conds := make([]string, 0, len(p.Status.Conditions))
		for _, c := range p.Status.Conditions {
			conds = append(conds, fmt.Sprintf("%s=%s", c.Type, c.Status))
		}
		b.WriteString(strings.Join(conds, ", "))
		b.WriteString("\n")
	}
	return b.String()
}

func formatNodeDetail(n *corev1.Node) string {
	var b strings.Builder
	// roles
	roles := make([]string, 0)
	for label := range n.Labels {
		if strings.HasPrefix(label, "node-role.kubernetes.io/") {
			roles = append(roles, strings.TrimPrefix(label, "node-role.kubernetes.io/"))
		}
	}
	if len(roles) == 0 {
		roles = []string{"<none>"}
	}

	// conditions
	ready := "Unknown"
	for _, c := range n.Status.Conditions {
		if c.Type == corev1.NodeReady {
			ready = string(c.Status)
		}
	}

	cap := n.Status.Capacity
	alloc := n.Status.Allocatable
	fmt.Fprintf(&b, "Node: %s  Roles: %s  Ready: %s  Version: %s\n",
		n.Name, strings.Join(roles, ","), ready, n.Status.NodeInfo.KubeletVersion)
	fmt.Fprintf(&b, "  OS: %s/%s  Runtime: %s\n",
		n.Status.NodeInfo.OperatingSystem, n.Status.NodeInfo.Architecture,
		n.Status.NodeInfo.ContainerRuntimeVersion)
	fmt.Fprintf(&b, "  Capacity:    CPU=%s  Memory=%s  Pods=%s\n",
		cap.Cpu().String(), cap.Memory().String(), cap.Pods().String())
	fmt.Fprintf(&b, "  Allocatable: CPU=%s  Memory=%s  Pods=%s\n",
		alloc.Cpu().String(), alloc.Memory().String(), alloc.Pods().String())
	return b.String()
}

func formatJSON(kind, name, namespace string, fields map[string]any) string {
	var b strings.Builder
	fmt.Fprintf(&b, "%s: %s/%s\n", kind, namespace, name)
	data, _ := json.MarshalIndent(fields, "", "  ")
	b.Write(data)
	b.WriteString("\n")
	return b.String()
}

func formatDeployConditions(conditions []appsv1.DeploymentCondition) []string {
	out := make([]string, 0, len(conditions))
	for _, c := range conditions {
		out = append(out, fmt.Sprintf("%s=%s (%s)", c.Type, c.Status, c.Reason))
	}
	return out
}

func strPtr(s *string) string {
	if s == nil {
		return "<none>"
	}
	return *s
}
