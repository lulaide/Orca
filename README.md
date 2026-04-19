# Orca

> 事件驱动的 AI 运维 Agent，为 Kubernetes 集群提供 7×24 自动值守、智能排障和团队协作。

---

## 快速部署

**前提**：一个可用的 Kubernetes 集群 + `kubectl` 已配置。

### 一键部署（国际）

```bash
kubectl apply -k https://github.com/lulaide/Orca/deploy/kubernetes
```

### 一键部署（国内加速）

```bash
kubectl apply -k https://github.com/lulaide/Orca/deploy/kubernetes-cn
```

### 访问

```bash
kubectl -n orca-system port-forward svc/orca 8080:80
# 打开 http://localhost:8080
```

### 配置

首次打开后进入 **Settings** 页面：

1. **LLM 配置**：填写 Provider（OpenAI / Anthropic）、API Key、Model
2. **Kubernetes**：集群内部署时自动连接（in-cluster ServiceAccount），无需配置
3. **MCP 连接**（可选）：添加外部 MCP Server（如 Cloudflare、Grafana），支持 OAuth 浏览器授权

配置持久化到数据库，Pod 重启后自动加载。

---

## 项目定位

Orca 是一个开源的运维 Agent 平台，核心解决三个问题：

1. **异常发现**：插件化告警源接入 + 自动巡检，第一时间感知异常
2. **智能排障**：LLM 驱动的 Agentic Loop，自主调用工具链进行根因分析
3. **团队协作**：事件追踪、模块分工、群通知、知识积累

和现有工具的区别：PagerDuty 只做告警通知不排查原因，HolmesGPT 会排查但没有团队协作和事件追踪，Kubiya 有 Agent 能力但闭源且贵。Orca 把 AI 排查 + 事件追踪 + 团队分工 + 知识积累统一在一个开源平台里。

目标用户：独立开发者、小型运维团队（3-50 人）、实验室/工作站运维场景。

---

## 架构总览

```
用户交互层
├── Web 前端 (React) ─────────┐
├── IM 机器人 (群发+私聊) ──────┤
├── MCP Server (对外暴露能力) ──┤
└── OAuth / SSO ───────────────┤
                                ▼
                     REST API + WebSocket
                                │
                                ▼
Agent Core
├── 事件路由器 ← 接收所有触发源的事件
├── 调查管理器 ← 管理 Investigation 会话状态
├── LLM 推理引擎 ← Agentic Loop + Function Calling
└── 知识系统 ← 结构化上下文 + 记忆 + RAG
        │
        ├── 触发插件（输入）
        │   ├── UptimeKuma / AlertManager / Grafana Webhook
        │   ├── CI/CD Webhook · 定时巡检 · 用户请求
        │   └── 通用 Webhook（自定义解析）
        │
        └── 工具层（执行）
            ├── 原生 SDK：client-go（get/describe/logs/restart/scale）
            ├── 受限 Bash：白名单命令（curl/dig/ping/traceroute）
            └── MCP 客户端：外部扩展（FOFA/Cloudflare/Grafana/云厂商）
```

---

## 当前已实现（Phase 1）

- [x] **Agent Core**：Event + Investigation + Event Router + 多轮 Agentic Loop
- [x] **LLM Engine**：OpenAI / Anthropic 兼容，Function Calling，流式输出
- [x] **Kubernetes Skill**：get_pods / get_pod_logs / describe_resource / get_events / get_node_status（只读）
- [x] **Trigger**：UptimeKuma Webhook + 用户对话
- [x] **MCP Client**：外接 MCP Server 动态扩展工具（stdio + SSE + OAuth 2.1 PKCE）
- [x] **Web 前端**：Chat 对话 / Events 列表+详情 / Investigation 管理 / Settings（LLM/K8s/MCP）
- [x] **零配置部署**：`kubectl apply -k` 一键安装，Web 内完成所有配置
- [x] **单镜像**：go:embed 前端静态文件，一个二进制搞定
- [x] **CI/CD**：GitHub Actions 自动构建镜像推送 GHCR + 阿里云 ACR

---

## 本地开发

```bash
# 后端（需要 Go 1.26+、PostgreSQL）
cd backend
cp config.yaml.example config.yaml  # 编辑填入 LLM API Key
go run ./cmd/orca

# 前端（需要 Node 22+）
cd frontend
npm install
npm run dev
# Vite dev server 自动代理 /api → localhost:9000
```

---

## 构建镜像

```bash
docker build -t orca:latest .
```

多阶段构建：Node 编译前端 → Go 编译后端（embed 前端产物）→ Alpine 最终镜像。

---

## 技术栈

| 组件 | 选型 |
|---|---|
| 后端 | Go + Gin + GORM |
| 前端 | React 19 + Vite 8 + Tailwind v4 |
| LLM 框架 | CloudWeGo Eino |
| MCP SDK | mark3labs/mcp-go |
| 数据库 | PostgreSQL |
| K8s 交互 | client-go |
| 部署 | Kubernetes（单镜像 Deployment） |

---

## 开发路线

### Phase 2 — 扩展能力

- Trigger 扩展：AlertManager / Grafana / CI/CD Webhook
- Knowledge：记忆 + RAG + pgvector 检索
- 受限 Bash 工具（白名单 + 超时 + 审计）
- MCP Server（对外暴露 Agent 能力）
- 写操作权限 + 审批流

### Phase 3 — 团队协作

- 值班轮转排班 / 事件升级策略
- 事件交接 + LLM 自动摘要
- 自动 Postmortem / 巡检 Dashboard

### Phase 4 — 高级特性

- 多集群支持 / Docker Compose 环境
- 自适应巡检频率
- 云厂商 MCP 接入 / Skill 市场

---

## License

MIT
