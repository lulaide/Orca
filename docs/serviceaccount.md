# Orca 的 Kubernetes ServiceAccount 使用指南

本文档说明 Orca 作为 Pod 部署到 Kubernetes 集群时，如何通过 ServiceAccount 获取访问 K8s API 的身份和权限，以及本地开发时如何通过 kubeconfig fallback 绕开这一层。

---

## 背景

Orca Agent 的核心能力是调用 K8s API 做只读诊断（`get_pods` / `get_pod_logs` / `describe_resource` / `get_events` / `get_node_status` 等）。调 API 时 API Server 要回答两个问题：

1. **Authentication（认证）**：这个请求是谁发的？
2. **Authorization（授权）**：这个"谁"有没有权限做这件事？

ServiceAccount 解决第一个问题（身份），RBAC 解决第二个问题（权限）。两者配套使用，缺一不可。

---

## ServiceAccount 是什么

K8s 里有两类身份：

| 类型 | 用途 | 管理方式 |
|---|---|---|
| `User` | 真人（运维/开发） | 集群外管理：证书、OIDC、LDAP 等 |
| `ServiceAccount` | Pod 里跑的进程 | 集群内对象，namespace 资源，YAML 管理 |

**ServiceAccount 就是给 Pod 用的账号。** Orca 作为 Pod 运行，自己不是"用户"，但它需要一个能被 API Server 认出来的身份——这就是 ServiceAccount。

---

## 完整部署清单

Orca MVP 阶段需要以下四个 K8s 资源，建议放在同一个 YAML 文件（如 `deploy/kubernetes/rbac.yaml`）：

### 1. Namespace

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: orca-system
```

### 2. ServiceAccount

```yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: orca
  namespace: orca-system
```

这一步只创建身份，没有任何权限。

### 3. ClusterRole（定义能做什么）

MVP 阶段只需要只读权限。写操作（如 `rollout_restart` / `scale` / `delete_pod`）留到 Phase 2 再追加。

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: orca-readonly
rules:
  # 核心资源
  - apiGroups: [""]
    resources:
      - pods
      - pods/log          # 读 Pod 日志需要单独授权子资源
      - events
      - nodes
      - nodes/status
      - services
      - endpoints
      - configmaps
      - namespaces
      - persistentvolumeclaims
    verbs: ["get", "list", "watch"]

  # 工作负载
  - apiGroups: ["apps"]
    resources:
      - deployments
      - statefulsets
      - daemonsets
      - replicasets
    verbs: ["get", "list", "watch"]

  # 网络
  - apiGroups: ["networking.k8s.io"]
    resources:
      - ingresses
      - networkpolicies
    verbs: ["get", "list", "watch"]

  # 批处理
  - apiGroups: ["batch"]
    resources:
      - jobs
      - cronjobs
    verbs: ["get", "list", "watch"]
```

**关于 Secret**：MVP 阶段**不建议**授权 Secret 的 `get`/`list`，避免 Agent 或 LLM 不小心把密钥回显到日志或对话里。确实需要证书过期检查时（Phase 2 的 `cert-check` 巡检），可以单独授权 `secrets` 的 `list` 但仅读取 metadata，或者给一个独立的 ServiceAccount 专门做这件事。

### 4. ClusterRoleBinding（把权限绑定到 ServiceAccount）

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: orca-readonly
subjects:
  - kind: ServiceAccount
    name: orca
    namespace: orca-system
roleRef:
  kind: ClusterRole
  name: orca-readonly
  apiGroup: rbac.authorization.k8s.io
```

### 5. Deployment（引用 ServiceAccount）

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: orca
  namespace: orca-system
spec:
  replicas: 1
  selector:
    matchLabels:
      app: orca
  template:
    metadata:
      labels:
        app: orca
    spec:
      serviceAccountName: orca        # ← 关键行
      automountServiceAccountToken: true   # 默认 true，显式写出提醒
      containers:
        - name: orca
          image: orca:latest
          ports:
            - containerPort: 8080
          env:
            - name: LLM_ENDPOINT
              valueFrom:
                configMapKeyRef:
                  name: orca-config
                  key: llm_endpoint
```

部署后，kubelet 会自动把 `orca` 这个 ServiceAccount 对应的 token 注入到容器的 `/var/run/secrets/kubernetes.io/serviceaccount/` 目录：

```
/var/run/secrets/kubernetes.io/serviceaccount/
├── token       # JWT，有效期默认 1 小时，kubelet 自动轮换
├── ca.crt      # API Server 的 CA 证书，用来验 TLS
└── namespace   # 当前 Pod 所在 namespace 纯文本
```

---

## 权限最小化原则

**不要一上来就给 `cluster-admin`**。AI Agent + 幻觉 + 管理员权限的组合可能让"我帮你清理一下旧 Pod"变成"我帮你删了整个 namespace"。

原则：

1. **MVP 只读**：只给 `get`/`list`/`watch`，绝不给 `create`/`update`/`patch`/`delete`
2. **默认不给 Secret**：避免密钥泄漏风险
3. **写操作单独授权**：Phase 2 加写操作时，另建一个 `orca-operator` ClusterRole，通过应用层的审批流拦截
4. **变更先预览**：重大 YAML 变更先 `kubectl diff -f rbac.yaml` 看看实际会改什么

---

## 验证 ServiceAccount 是否正常工作

部署完成后，有几种方式验证：

### 1. 从集群外用 kubectl 模拟 ServiceAccount

```bash
# 验证 orca 能不能 list pods
kubectl auth can-i list pods \
  --as=system:serviceaccount:orca-system:orca \
  --all-namespaces
# 期望输出：yes

# 验证 orca 不能 delete pods（负面测试）
kubectl auth can-i delete pods \
  --as=system:serviceaccount:orca-system:orca \
  --all-namespaces
# 期望输出：no
```

### 2. 从 Pod 内部发测试请求

```bash
kubectl exec -it -n orca-system deploy/orca -- sh
# 进入容器后：
TOKEN=$(cat /var/run/secrets/kubernetes.io/serviceaccount/token)
CA=/var/run/secrets/kubernetes.io/serviceaccount/ca.crt
curl --cacert $CA -H "Authorization: Bearer $TOKEN" \
  https://kubernetes.default.svc/api/v1/namespaces/default/pods
```

能返回 Pod JSON 列表说明 token 有效、权限正确。

---

## 排障

| 现象 | 可能原因 |
|---|---|
| `forbidden: User "system:serviceaccount:orca-system:orca" cannot list pods` | 忘建 ClusterRoleBinding，或 Role/Binding 里 resource/verb 拼错 |
| `the server has asked for the client to provide credentials` | Pod 引用的 SA 不存在（`serviceAccountName` 拼错） |
| `stat /var/run/secrets/kubernetes.io/serviceaccount/token: no such file or directory` | `automountServiceAccountToken: false` 或 SA 未关联 |
| Pod 重启后 token 不刷新 | K8s 1.22+ 后 token 由 kubelet 动态轮换，无需干预；低版本需考虑 |

---

## 参考

- Kubernetes 官方文档：[Configure Service Accounts for Pods](https://kubernetes.io/docs/tasks/configure-pod-container/configure-service-account/)
- RBAC 官方文档：[Using RBAC Authorization](https://kubernetes.io/docs/reference/access-authn-authz/rbac/)
- client-go 示例：[in-cluster-client-configuration](https://github.com/kubernetes/client-go/tree/master/examples/in-cluster-client-configuration)
