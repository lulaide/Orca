package api

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"sort"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	metricsv "k8s.io/metrics/pkg/client/clientset/versioned"
)

// ---- 响应结构 ----

type clusterOverview struct {
	CPU    cpuBlock    `json:"cpu"`
	Memory memBlock    `json:"memory"`
	Pods   podsBlock   `json:"pods"`
	Nodes  nodesBlock  `json:"nodes"`

	MetricsAvailable bool              `json:"metrics_available"`
	NodeDetails      []nodeDetail      `json:"node_details"`
	Namespaces       []namespaceSummary `json:"namespaces"`
	TopPodsCPU       []podResource     `json:"top_pods_cpu"`
	TopPodsMemory    []podResource     `json:"top_pods_memory"`
	Workloads        workloadHealth    `json:"workloads"`
	ProblemPods      []problemPod      `json:"problem_pods"`
}

type cpuBlock struct {
	Usage       *float64 `json:"usage"`
	Requests    float64  `json:"requests"`
	Limits      float64  `json:"limits"`
	Allocatable float64  `json:"allocatable"`
	Capacity    float64  `json:"capacity"`
}
type memBlock struct {
	Usage       *int64 `json:"usage"`
	Requests    int64  `json:"requests"`
	Limits      int64  `json:"limits"`
	Allocatable int64  `json:"allocatable"`
	Capacity    int64  `json:"capacity"`
}
type podsBlock struct {
	Usage       int   `json:"usage"`
	Allocatable int64 `json:"allocatable"`
	Capacity    int64 `json:"capacity"`
}
type nodesBlock struct {
	Total int `json:"total"`
	Ready int `json:"ready"`
}

type nodeDetail struct {
	Name           string   `json:"name"`
	CPUUsage       *float64 `json:"cpu_usage"`
	CPUAllocatable float64  `json:"cpu_allocatable"`
	CPUCapacity    float64  `json:"cpu_capacity"`
	MemUsage       *int64   `json:"mem_usage"`
	MemAllocatable int64    `json:"mem_allocatable"`
	MemCapacity    int64    `json:"mem_capacity"`
	PodCount       int      `json:"pod_count"`
	PodCapacity    int64    `json:"pod_capacity"`
	Ready          bool     `json:"ready"`
	Conditions     []string `json:"conditions"`
}

type namespaceSummary struct {
	Name        string  `json:"name"`
	PodCount    int     `json:"pod_count"`
	CPURequests float64 `json:"cpu_requests"`
	CPULimits   float64 `json:"cpu_limits"`
	MemRequests int64   `json:"mem_requests"`
	MemLimits   int64   `json:"mem_limits"`
}

type podResource struct {
	Name      string  `json:"name"`
	Namespace string  `json:"namespace"`
	CPU       float64 `json:"cpu"`
	Memory    int64   `json:"memory"`
}

type workloadHealth struct {
	Deployments  workloadCounts `json:"deployments"`
	StatefulSets workloadCounts `json:"statefulsets"`
	DaemonSets   workloadCounts `json:"daemonsets"`
}
type workloadCounts struct {
	Total       int `json:"total"`
	Ready       int `json:"ready"`
	Degraded    int `json:"degraded"`
	Unavailable int `json:"unavailable"`
}

type problemPod struct {
	Name      string `json:"name"`
	Namespace string `json:"namespace"`
	Reason    string `json:"reason"`
	Restarts  int32  `json:"restarts"`
	Message   string `json:"message"`
	Age       string `json:"age"`
}

// ---- Handler ----

func (d *Deps) handleClusterOverview(c *gin.Context) {
	cs := d.Kube.Clientset()
	if cs == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "kubernetes is not configured"})
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 10*time.Second)
	defer cancel()

	// 并行获取数据
	var (
		nodes    *corev1.NodeList
		pods     *corev1.PodList
		deploys  *appsv1.DeploymentList
		stses    *appsv1.StatefulSetList
		dsets    *appsv1.DaemonSetList
		nodeUsage map[string]podResource // name → cpu/mem usage
		podUsage  []podResource
		mu        sync.Mutex
		wg        sync.WaitGroup
	)

	metricsAvailable := false

	// 核心 API（必须成功）
	type result struct {
		err error
		src string
	}
	errs := make(chan result, 5)

	wg.Add(5)
	go func() { defer wg.Done(); var e error; nodes, e = cs.CoreV1().Nodes().List(ctx, metav1.ListOptions{}); errs <- result{e, "nodes"} }()
	go func() { defer wg.Done(); var e error; pods, e = cs.CoreV1().Pods("").List(ctx, metav1.ListOptions{}); errs <- result{e, "pods"} }()
	go func() { defer wg.Done(); var e error; deploys, e = cs.AppsV1().Deployments("").List(ctx, metav1.ListOptions{}); errs <- result{e, "deployments"} }()
	go func() { defer wg.Done(); var e error; stses, e = cs.AppsV1().StatefulSets("").List(ctx, metav1.ListOptions{}); errs <- result{e, "statefulsets"} }()
	go func() { defer wg.Done(); var e error; dsets, e = cs.AppsV1().DaemonSets("").List(ctx, metav1.ListOptions{}); errs <- result{e, "daemonsets"} }()

	// Metrics API（可失败）
	wg.Add(1)
	go func() {
		defer wg.Done()
		cfg := d.Kube.RestConfig()
		if cfg == nil {
			return
		}
		mc, err := metricsv.NewForConfig(cfg)
		if err != nil {
			log.Printf("overview: metrics client: %v", err)
			return
		}
		// 节点指标
		nm, err := mc.MetricsV1beta1().NodeMetricses().List(ctx, metav1.ListOptions{})
		if err != nil {
			return
		}
		mu.Lock()
		metricsAvailable = true
		nodeUsage = make(map[string]podResource, len(nm.Items))
		for _, n := range nm.Items {
			nodeUsage[n.Name] = podResource{
				CPU:    cpuToCores(n.Usage[corev1.ResourceCPU]),
				Memory: qval(corev1.ResourceList(n.Usage), corev1.ResourceMemory),
			}
		}
		mu.Unlock()

		// Pod 指标
		pm, err := mc.MetricsV1beta1().PodMetricses("").List(ctx, metav1.ListOptions{})
		if err != nil {
			return
		}
		mu.Lock()
		podUsage = make([]podResource, 0, len(pm.Items))
		for _, p := range pm.Items {
			var cpu float64
			var mem int64
			for _, ctn := range p.Containers {
				cpu += cpuToCores(ctn.Usage[corev1.ResourceCPU])
				mem += qval(corev1.ResourceList(ctn.Usage), corev1.ResourceMemory)
			}
			podUsage = append(podUsage, podResource{
				Name: p.Name, Namespace: p.Namespace,
				CPU: cpu, Memory: mem,
			})
		}
		mu.Unlock()
	}()

	wg.Wait()
	close(errs)

	for r := range errs {
		if r.err != nil {
			c.JSON(http.StatusBadGateway, gin.H{"error": fmt.Sprintf("list %s: %s", r.src, r.err)})
			return
		}
	}

	// ---- 组装响应 ----
	resp := clusterOverview{
		MetricsAvailable: metricsAvailable,
		NodeDetails:      []nodeDetail{},
		Namespaces:       []namespaceSummary{},
		TopPodsCPU:       []podResource{},
		TopPodsMemory:    []podResource{},
		ProblemPods:      []problemPod{},
	}

	// 节点详情
	nodeMap := make(map[string]*nodeDetail, len(nodes.Items))
	for _, n := range nodes.Items {
		nd := nodeDetail{Name: n.Name}
		nd.Ready = isNodeReady(n)
		for _, cond := range n.Status.Conditions {
			if cond.Type == corev1.NodeReady {
				continue
			}
			if cond.Status == corev1.ConditionTrue {
				nd.Conditions = append(nd.Conditions, string(cond.Type))
			}
		}
		if nd.Conditions == nil {
			nd.Conditions = []string{}
		}
		nd.CPUAllocatable = cpuToCores(n.Status.Allocatable[corev1.ResourceCPU])
		nd.CPUCapacity = cpuToCores(n.Status.Capacity[corev1.ResourceCPU])
		nd.MemAllocatable = qval(n.Status.Allocatable, corev1.ResourceMemory)
		nd.MemCapacity = qval(n.Status.Capacity, corev1.ResourceMemory)
		nd.PodCapacity = qval(n.Status.Allocatable, corev1.ResourcePods)

		if usage, ok := nodeUsage[n.Name]; ok {
			nd.CPUUsage = &usage.CPU
			nd.MemUsage = &usage.Memory
		}

		resp.Nodes.Total++
		if nd.Ready {
			resp.Nodes.Ready++
		}
		resp.CPU.Allocatable += nd.CPUAllocatable
		resp.CPU.Capacity += nd.CPUCapacity
		resp.Memory.Allocatable += nd.MemAllocatable
		resp.Memory.Capacity += nd.MemCapacity
		resp.Pods.Allocatable += nd.PodCapacity
		resp.Pods.Capacity += qval(n.Status.Capacity, corev1.ResourcePods)

		nodeMap[n.Name] = &nd
	}

	// 处理 Pods
	nsMap := make(map[string]*namespaceSummary)
	now := time.Now()

	for i := range pods.Items {
		p := &pods.Items[i]
		if p.Status.Phase == corev1.PodSucceeded || p.Status.Phase == corev1.PodFailed {
			continue
		}
		if p.Status.Phase == corev1.PodRunning {
			resp.Pods.Usage++
		}

		// 节点 pod 计数
		if nd, ok := nodeMap[p.Spec.NodeName]; ok {
			nd.PodCount++
		}

		// 命名空间汇总
		ns := nsMap[p.Namespace]
		if ns == nil {
			ns = &namespaceSummary{Name: p.Namespace}
			nsMap[p.Namespace] = ns
		}
		ns.PodCount++

		for _, ctn := range p.Spec.Containers {
			if req := ctn.Resources.Requests; req != nil {
				if v, ok := req[corev1.ResourceCPU]; ok {
					c := cpuToCores(v)
					resp.CPU.Requests += c
					ns.CPURequests += c
				}
				if v, ok := req[corev1.ResourceMemory]; ok {
					resp.Memory.Requests += v.Value()
					ns.MemRequests += v.Value()
				}
			}
			if lim := ctn.Resources.Limits; lim != nil {
				if v, ok := lim[corev1.ResourceCPU]; ok {
					c := cpuToCores(v)
					resp.CPU.Limits += c
					ns.CPULimits += c
				}
				if v, ok := lim[corev1.ResourceMemory]; ok {
					resp.Memory.Limits += v.Value()
					ns.MemLimits += v.Value()
				}
			}
		}

		// 异常 Pod 检测
		if pp := detectProblem(p, now); pp != nil {
			resp.ProblemPods = append(resp.ProblemPods, *pp)
		}
	}

	// 节点详情列表
	for _, nd := range nodeMap {
		resp.NodeDetails = append(resp.NodeDetails, *nd)
	}
	sort.Slice(resp.NodeDetails, func(i, j int) bool { return resp.NodeDetails[i].Name < resp.NodeDetails[j].Name })

	// 命名空间列表（按 CPU requests 降序）
	for _, ns := range nsMap {
		resp.Namespaces = append(resp.Namespaces, *ns)
	}
	sort.Slice(resp.Namespaces, func(i, j int) bool { return resp.Namespaces[i].CPURequests > resp.Namespaces[j].CPURequests })

	// 汇总 CPU/Memory usage
	if metricsAvailable {
		var cpuSum float64
		var memSum int64
		for _, u := range nodeUsage {
			cpuSum += u.CPU
			memSum += u.Memory
		}
		resp.CPU.Usage = &cpuSum
		resp.Memory.Usage = &memSum
	}

	// Top pods
	if len(podUsage) > 0 {
		sort.Slice(podUsage, func(i, j int) bool { return podUsage[i].CPU > podUsage[j].CPU })
		n := 10
		if len(podUsage) < n { n = len(podUsage) }
		resp.TopPodsCPU = append([]podResource{}, podUsage[:n]...)

		sort.Slice(podUsage, func(i, j int) bool { return podUsage[i].Memory > podUsage[j].Memory })
		n = 10
		if len(podUsage) < n { n = len(podUsage) }
		resp.TopPodsMemory = append([]podResource{}, podUsage[:n]...)
	}

	// 工作负载健康
	resp.Workloads.Deployments = countDeployments(deploys.Items)
	resp.Workloads.StatefulSets = countStatefulSets(stses.Items)
	resp.Workloads.DaemonSets = countDaemonSets(dsets.Items)

	c.JSON(http.StatusOK, resp)
}

// ---- 辅助函数 ----

func isNodeReady(n corev1.Node) bool {
	for _, c := range n.Status.Conditions {
		if c.Type == corev1.NodeReady {
			return c.Status == corev1.ConditionTrue
		}
	}
	return false
}

func detectProblem(p *corev1.Pod, now time.Time) *problemPod {
	var maxRestarts int32
	for _, cs := range p.Status.ContainerStatuses {
		if cs.RestartCount > maxRestarts {
			maxRestarts = cs.RestartCount
		}
		if cs.State.Waiting != nil {
			reason := cs.State.Waiting.Reason
			switch reason {
			case "CrashLoopBackOff", "ImagePullBackOff", "ErrImagePull", "CreateContainerConfigError":
				return &problemPod{
					Name: p.Name, Namespace: p.Namespace,
					Reason: reason, Restarts: cs.RestartCount,
					Message: cs.State.Waiting.Message,
					Age:     formatAge(now.Sub(p.CreationTimestamp.Time)),
				}
			}
		}
	}
	// Pending 超过 5 分钟
	if p.Status.Phase == corev1.PodPending && now.Sub(p.CreationTimestamp.Time) > 5*time.Minute {
		msg := ""
		for _, cond := range p.Status.Conditions {
			if cond.Status == corev1.ConditionFalse && cond.Message != "" {
				msg = cond.Message
				break
			}
		}
		return &problemPod{
			Name: p.Name, Namespace: p.Namespace,
			Reason: "Pending", Restarts: maxRestarts, Message: msg,
			Age: formatAge(now.Sub(p.CreationTimestamp.Time)),
		}
	}
	// 高重启次数
	if maxRestarts > 10 {
		return &problemPod{
			Name: p.Name, Namespace: p.Namespace,
			Reason: "HighRestarts", Restarts: maxRestarts,
			Age: formatAge(now.Sub(p.CreationTimestamp.Time)),
		}
	}
	return nil
}

func formatAge(d time.Duration) string {
	switch {
	case d < time.Minute:
		return fmt.Sprintf("%ds", int(d.Seconds()))
	case d < time.Hour:
		return fmt.Sprintf("%dm", int(d.Minutes()))
	case d < 24*time.Hour:
		return fmt.Sprintf("%dh", int(d.Hours()))
	default:
		return fmt.Sprintf("%dd", int(d.Hours()/24))
	}
}

func countDeployments(items []appsv1.Deployment) workloadCounts {
	var wc workloadCounts
	for _, d := range items {
		wc.Total++
		desired := int32(1)
		if d.Spec.Replicas != nil {
			desired = *d.Spec.Replicas
		}
		if desired == 0 {
			wc.Ready++
			continue
		}
		if d.Status.AvailableReplicas >= desired {
			wc.Ready++
		} else if d.Status.AvailableReplicas > 0 {
			wc.Degraded++
		} else {
			wc.Unavailable++
		}
	}
	return wc
}

func countStatefulSets(items []appsv1.StatefulSet) workloadCounts {
	var wc workloadCounts
	for _, s := range items {
		wc.Total++
		desired := int32(1)
		if s.Spec.Replicas != nil {
			desired = *s.Spec.Replicas
		}
		if desired == 0 {
			wc.Ready++
			continue
		}
		if s.Status.ReadyReplicas >= desired {
			wc.Ready++
		} else if s.Status.ReadyReplicas > 0 {
			wc.Degraded++
		} else {
			wc.Unavailable++
		}
	}
	return wc
}

func countDaemonSets(items []appsv1.DaemonSet) workloadCounts {
	var wc workloadCounts
	for _, ds := range items {
		wc.Total++
		if ds.Status.DesiredNumberScheduled == 0 {
			wc.Ready++
			continue
		}
		if ds.Status.NumberReady >= ds.Status.DesiredNumberScheduled {
			wc.Ready++
		} else if ds.Status.NumberReady > 0 {
			wc.Degraded++
		} else {
			wc.Unavailable++
		}
	}
	return wc
}

// qval 从资源列表中安全取值（避免 map index 不可寻址的问题）。
func qval(rl corev1.ResourceList, name corev1.ResourceName) int64 {
	q := rl[name]
	return q.Value()
}
