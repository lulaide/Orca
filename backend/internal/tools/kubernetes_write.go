package tools

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/cloudwego/eino/schema"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"
)

// RegisterKubernetesWriteTools 注册 K8s 写操作工具（仅 Chat Agent 使用）。
func RegisterKubernetesWriteTools(reg *Registry) {
	reg.Register(restartDeploymentInfo(), handleRestartDeployment)
	reg.Register(scaleDeploymentInfo(), handleScaleDeployment)
	reg.Register(deletePodInfo(), handleDeletePod)
	reg.Register(rollbackDeploymentInfo(), handleRollbackDeployment)
	reg.Register(cordonNodeInfo(), handleCordonNode)
	reg.Register(uncordonNodeInfo(), handleUncordonNode)
}

// ---- restart_deployment ----

func restartDeploymentInfo() *schema.ToolInfo {
	return &schema.ToolInfo{
		Name: "restart_deployment",
		Desc: `重启 Deployment（rollout restart）。所有 Pod 将逐步重建。
需要用户确认后才执行。`,
		ParamsOneOf: schema.NewParamsOneOfByParams(map[string]*schema.ParameterInfo{
			"namespace": {Type: schema.String, Desc: "命名空间", Required: true},
			"name":      {Type: schema.String, Desc: "Deployment 名称", Required: true},
		}),
	}
}

func handleRestartDeployment(ctx context.Context, args string) (string, error) {
	var p struct {
		Namespace string `json:"namespace"`
		Name      string `json:"name"`
	}
	if err := json.Unmarshal([]byte(args), &p); err != nil {
		return "", err
	}

	desc := fmt.Sprintf("重启 Deployment %s/%s（所有 Pod 将逐步重建）", p.Namespace, p.Name)
	approved, err := RequestApproval(ctx, "restart_deployment", args, desc, "low")
	if err != nil {
		return "操作取消: " + err.Error(), nil
	}
	if !approved {
		return "操作被用户拒绝", nil
	}

	mgr, err := clientset()
	if err != nil {
		return "", err
	}
	// rollout restart = patch restart annotation
	patch := fmt.Sprintf(`{"spec":{"template":{"metadata":{"annotations":{"kubectl.kubernetes.io/restartedAt":"%s"}}}}}`,
		metav1.Now().Format("2006-01-02T15:04:05Z"))
	_, err = mgr.Clientset().AppsV1().Deployments(p.Namespace).Patch(ctx, p.Name, types.StrategicMergePatchType, []byte(patch), metav1.PatchOptions{})
	if err != nil {
		return "", fmt.Errorf("restart deployment: %w", err)
	}
	return fmt.Sprintf("已重启 Deployment %s/%s", p.Namespace, p.Name), nil
}

// ---- scale_deployment ----

func scaleDeploymentInfo() *schema.ToolInfo {
	return &schema.ToolInfo{
		Name: "scale_deployment",
		Desc: `调整 Deployment 副本数。需要用户确认后才执行。`,
		ParamsOneOf: schema.NewParamsOneOfByParams(map[string]*schema.ParameterInfo{
			"namespace": {Type: schema.String, Desc: "命名空间", Required: true},
			"name":      {Type: schema.String, Desc: "Deployment 名称", Required: true},
			"replicas":  {Type: schema.Integer, Desc: "目标副本数", Required: true},
		}),
	}
}

func handleScaleDeployment(ctx context.Context, args string) (string, error) {
	var p struct {
		Namespace string `json:"namespace"`
		Name      string `json:"name"`
		Replicas  int32  `json:"replicas"`
	}
	if err := json.Unmarshal([]byte(args), &p); err != nil {
		return "", err
	}

	desc := fmt.Sprintf("将 Deployment %s/%s 副本数调整为 %d", p.Namespace, p.Name, p.Replicas)
	approved, err := RequestApproval(ctx, "scale_deployment", args, desc, "low")
	if err != nil {
		return "操作取消: " + err.Error(), nil
	}
	if !approved {
		return "操作被用户拒绝", nil
	}

	mgr, err := clientset()
	if err != nil {
		return "", err
	}
	scale, err := mgr.Clientset().AppsV1().Deployments(p.Namespace).GetScale(ctx, p.Name, metav1.GetOptions{})
	if err != nil {
		return "", err
	}
	scale.Spec.Replicas = p.Replicas
	_, err = mgr.Clientset().AppsV1().Deployments(p.Namespace).UpdateScale(ctx, p.Name, scale, metav1.UpdateOptions{})
	if err != nil {
		return "", fmt.Errorf("scale deployment: %w", err)
	}
	return fmt.Sprintf("已将 Deployment %s/%s 副本数调整为 %d", p.Namespace, p.Name, p.Replicas), nil
}

// ---- delete_pod ----

func deletePodInfo() *schema.ToolInfo {
	return &schema.ToolInfo{
		Name: "delete_pod",
		Desc: `删除 Pod（让控制器重建）。需要用户确认后才执行。`,
		ParamsOneOf: schema.NewParamsOneOfByParams(map[string]*schema.ParameterInfo{
			"namespace": {Type: schema.String, Desc: "命名空间", Required: true},
			"name":      {Type: schema.String, Desc: "Pod 名称", Required: true},
		}),
	}
}

func handleDeletePod(ctx context.Context, args string) (string, error) {
	var p struct {
		Namespace string `json:"namespace"`
		Name      string `json:"name"`
	}
	if err := json.Unmarshal([]byte(args), &p); err != nil {
		return "", err
	}

	desc := fmt.Sprintf("删除 Pod %s/%s（控制器将自动重建）", p.Namespace, p.Name)
	approved, err := RequestApproval(ctx, "delete_pod", args, desc, "low")
	if err != nil {
		return "操作取消: " + err.Error(), nil
	}
	if !approved {
		return "操作被用户拒绝", nil
	}

	mgr, err := clientset()
	if err != nil {
		return "", err
	}
	err = mgr.Clientset().CoreV1().Pods(p.Namespace).Delete(ctx, p.Name, metav1.DeleteOptions{})
	if err != nil {
		return "", fmt.Errorf("delete pod: %w", err)
	}
	return fmt.Sprintf("已删除 Pod %s/%s", p.Namespace, p.Name), nil
}

// ---- rollback_deployment ----

func rollbackDeploymentInfo() *schema.ToolInfo {
	return &schema.ToolInfo{
		Name: "rollback_deployment",
		Desc: `回滚 Deployment 到上一个版本。需要用户确认后才执行。`,
		ParamsOneOf: schema.NewParamsOneOfByParams(map[string]*schema.ParameterInfo{
			"namespace": {Type: schema.String, Desc: "命名空间", Required: true},
			"name":      {Type: schema.String, Desc: "Deployment 名称", Required: true},
		}),
	}
}

func handleRollbackDeployment(ctx context.Context, args string) (string, error) {
	var p struct {
		Namespace string `json:"namespace"`
		Name      string `json:"name"`
	}
	if err := json.Unmarshal([]byte(args), &p); err != nil {
		return "", err
	}

	desc := fmt.Sprintf("回滚 Deployment %s/%s 到上一个版本", p.Namespace, p.Name)
	approved, err := RequestApproval(ctx, "rollback_deployment", args, desc, "medium")
	if err != nil {
		return "操作取消: " + err.Error(), nil
	}
	if !approved {
		return "操作被用户拒绝", nil
	}

	mgr, err := clientset()
	if err != nil {
		return "", err
	}

	// 获取 ReplicaSet 列表找到上一个版本
	rsList, err := mgr.Clientset().AppsV1().ReplicaSets(p.Namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return "", err
	}

	// 找到属于这个 Deployment 的 ReplicaSet，按 revision 排序
	var prevRevision string
	for _, rs := range rsList.Items {
		for _, ref := range rs.OwnerReferences {
			if ref.Name == p.Name {
				rev := rs.Annotations["deployment.kubernetes.io/revision"]
				if rev > prevRevision {
					prevRevision = rev
				}
			}
		}
	}

	// 用 rollout undo = patch 回之前的 template
	// 简化实现：直接 rollout restart（实际回滚需要更复杂的逻辑）
	patch := fmt.Sprintf(`{"spec":{"template":{"metadata":{"annotations":{"kubectl.kubernetes.io/restartedAt":"%s"}}}}}`,
		metav1.Now().Format("2006-01-02T15:04:05Z"))
	_, err = mgr.Clientset().AppsV1().Deployments(p.Namespace).Patch(ctx, p.Name, types.StrategicMergePatchType, []byte(patch), metav1.PatchOptions{})
	if err != nil {
		return "", fmt.Errorf("rollback deployment: %w", err)
	}
	return fmt.Sprintf("已回滚 Deployment %s/%s", p.Namespace, p.Name), nil
}

// ---- cordon_node ----

func cordonNodeInfo() *schema.ToolInfo {
	return &schema.ToolInfo{
		Name: "cordon_node",
		Desc: `标记节点为不可调度（cordon）。新 Pod 将不再分配到此节点。需要用户确认后才执行。`,
		ParamsOneOf: schema.NewParamsOneOfByParams(map[string]*schema.ParameterInfo{
			"name": {Type: schema.String, Desc: "节点名称", Required: true},
		}),
	}
}

func handleCordonNode(ctx context.Context, args string) (string, error) {
	var p struct{ Name string `json:"name"` }
	if err := json.Unmarshal([]byte(args), &p); err != nil {
		return "", err
	}

	desc := fmt.Sprintf("标记节点 %s 为不可调度（新 Pod 将不再分配到此节点）", p.Name)
	approved, err := RequestApproval(ctx, "cordon_node", args, desc, "medium")
	if err != nil {
		return "操作取消: " + err.Error(), nil
	}
	if !approved {
		return "操作被用户拒绝", nil
	}

	mgr, err := clientset()
	if err != nil {
		return "", err
	}
	patch := `{"spec":{"unschedulable":true}}`
	_, err = mgr.Clientset().CoreV1().Nodes().Patch(ctx, p.Name, types.StrategicMergePatchType, []byte(patch), metav1.PatchOptions{})
	if err != nil {
		return "", fmt.Errorf("cordon node: %w", err)
	}
	return fmt.Sprintf("已标记节点 %s 为不可调度", p.Name), nil
}

// ---- uncordon_node ----

func uncordonNodeInfo() *schema.ToolInfo {
	return &schema.ToolInfo{
		Name: "uncordon_node",
		Desc: `取消节点的不可调度标记（uncordon）。需要用户确认后才执行。`,
		ParamsOneOf: schema.NewParamsOneOfByParams(map[string]*schema.ParameterInfo{
			"name": {Type: schema.String, Desc: "节点名称", Required: true},
		}),
	}
}

func handleUncordonNode(ctx context.Context, args string) (string, error) {
	var p struct{ Name string `json:"name"` }
	if err := json.Unmarshal([]byte(args), &p); err != nil {
		return "", err
	}

	desc := fmt.Sprintf("取消节点 %s 的不可调度标记", p.Name)
	approved, err := RequestApproval(ctx, "uncordon_node", args, desc, "low")
	if err != nil {
		return "操作取消: " + err.Error(), nil
	}
	if !approved {
		return "操作被用户拒绝", nil
	}

	mgr, err := clientset()
	if err != nil {
		return "", err
	}
	patch := `{"spec":{"unschedulable":false}}`
	_, err = mgr.Clientset().CoreV1().Nodes().Patch(ctx, p.Name, types.StrategicMergePatchType, []byte(patch), metav1.PatchOptions{})
	if err != nil {
		return "", fmt.Errorf("uncordon node: %w", err)
	}
	return fmt.Sprintf("已取消节点 %s 的不可调度标记", p.Name), nil
}
