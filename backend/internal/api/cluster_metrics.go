package api

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// clusterMetricsResponse 仿 Lens Dashboard 的 CPU / Memory / Pods 三卡。
// CPU 单位: core (float);  Memory 单位: byte;  Pods: 个数。
// Usage 字段在 metrics-server 不可用时为 null,前端只显示其它几项。
type clusterMetricsResponse struct {
	CPU struct {
		Usage       *float64 `json:"usage"`
		Requests    float64  `json:"requests"`
		Limits      float64  `json:"limits"`
		Allocatable float64  `json:"allocatable"`
		Capacity    float64  `json:"capacity"`
	} `json:"cpu"`
	Memory struct {
		Usage       *int64 `json:"usage"`
		Requests    int64  `json:"requests"`
		Limits      int64  `json:"limits"`
		Allocatable int64  `json:"allocatable"`
		Capacity    int64  `json:"capacity"`
	} `json:"memory"`
	Pods struct {
		Usage       int   `json:"usage"`
		Allocatable int64 `json:"allocatable"`
		Capacity    int64 `json:"capacity"`
	} `json:"pods"`
	Nodes struct {
		Total int `json:"total"`
		Ready int `json:"ready"`
	} `json:"nodes"`
	MetricsAvailable bool `json:"metrics_available"`
}

// nodeMetricsList 是 metrics.k8s.io/v1beta1 /nodes 响应的最小解码 shape。
type nodeMetricsList struct {
	Items []struct {
		Metadata struct {
			Name string `json:"name"`
		} `json:"metadata"`
		Usage struct {
			CPU    string `json:"cpu"`
			Memory string `json:"memory"`
		} `json:"usage"`
	} `json:"items"`
}

func (d *Deps) handleClusterMetrics(c *gin.Context) {
	cs := d.Kube.Clientset()
	if cs == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "kubernetes is not configured"})
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 6*time.Second)
	defer cancel()

	nodes, err := cs.CoreV1().Nodes().List(ctx, metav1.ListOptions{})
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "list nodes: " + err.Error()})
		return
	}

	pods, err := cs.CoreV1().Pods("").List(ctx, metav1.ListOptions{})
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "list pods: " + err.Error()})
		return
	}

	var resp clusterMetricsResponse

	// --- Nodes: allocatable / capacity ---
	for _, n := range nodes.Items {
		resp.Nodes.Total++
		for _, cond := range n.Status.Conditions {
			if cond.Type == corev1.NodeReady && cond.Status == corev1.ConditionTrue {
				resp.Nodes.Ready++
				break
			}
		}
		if cpuAlloc, ok := n.Status.Allocatable[corev1.ResourceCPU]; ok {
			resp.CPU.Allocatable += cpuToCores(cpuAlloc)
		}
		if cpuCap, ok := n.Status.Capacity[corev1.ResourceCPU]; ok {
			resp.CPU.Capacity += cpuToCores(cpuCap)
		}
		if memAlloc, ok := n.Status.Allocatable[corev1.ResourceMemory]; ok {
			resp.Memory.Allocatable += memAlloc.Value()
		}
		if memCap, ok := n.Status.Capacity[corev1.ResourceMemory]; ok {
			resp.Memory.Capacity += memCap.Value()
		}
		if podsAlloc, ok := n.Status.Allocatable[corev1.ResourcePods]; ok {
			resp.Pods.Allocatable += podsAlloc.Value()
		}
		if podsCap, ok := n.Status.Capacity[corev1.ResourcePods]; ok {
			resp.Pods.Capacity += podsCap.Value()
		}
	}

	// --- Pods: running count + requests/limits 汇总 ---
	for _, p := range pods.Items {
		// 只统计未进入终态的 pod
		if p.Status.Phase == corev1.PodSucceeded || p.Status.Phase == corev1.PodFailed {
			continue
		}
		if p.Status.Phase == corev1.PodRunning {
			resp.Pods.Usage++
		}
		for _, ctn := range p.Spec.Containers {
			if req := ctn.Resources.Requests; req != nil {
				if v, ok := req[corev1.ResourceCPU]; ok {
					resp.CPU.Requests += cpuToCores(v)
				}
				if v, ok := req[corev1.ResourceMemory]; ok {
					resp.Memory.Requests += v.Value()
				}
			}
			if lim := ctn.Resources.Limits; lim != nil {
				if v, ok := lim[corev1.ResourceCPU]; ok {
					resp.CPU.Limits += cpuToCores(v)
				}
				if v, ok := lim[corev1.ResourceMemory]; ok {
					resp.Memory.Limits += v.Value()
				}
			}
		}
	}

	// --- 尝试 metrics-server (可选, 失败静默) ---
	if raw, err := cs.RESTClient().
		Get().
		AbsPath("/apis/metrics.k8s.io/v1beta1/nodes").
		DoRaw(ctx); err == nil {
		var nm nodeMetricsList
		if json.Unmarshal(raw, &nm) == nil {
			var cpuSum float64
			var memSum int64
			for _, item := range nm.Items {
				if q, err := resource.ParseQuantity(item.Usage.CPU); err == nil {
					cpuSum += cpuToCores(q)
				}
				if q, err := resource.ParseQuantity(item.Usage.Memory); err == nil {
					memSum += q.Value()
				}
			}
			resp.CPU.Usage = &cpuSum
			resp.Memory.Usage = &memSum
			resp.MetricsAvailable = true
		}
	}

	c.JSON(http.StatusOK, resp)
}

// cpuToCores 把 Quantity (如 "500m" / "2") 转成 core 数。
// 用 MilliValue()/1000 比 Value() 更精确(后者对小于 1 核的值直接截成 0)。
func cpuToCores(q resource.Quantity) float64 {
	return float64(q.MilliValue()) / 1000.0
}
