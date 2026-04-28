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

首次打开后进入设置页面：

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

---

## 架构总览

```
用户交互层
├── Web 前端 (React) ─────────┐
├── 飞书机器人（通知+交互）─────┤
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
└── Skill 系统 ← Agent 渐进式记忆（按服务组织，持续学习）
        │
        ├── 触发插件（输入）
        │   ├── UptimeKuma / AlertManager / Grafana Webhook
        │   ├── 通用 Webhook（自定义解析）
        │   └── 用户请求（Web 对话 / 飞书命令）
        │
        └── 工具层（执行）
            ├── K8s SDK：client-go + metrics-server（只读诊断）
            ├── Skill 工具：read_skill / update_skill_section（知识读写）
            └── MCP 客户端：外部扩展（Cloudflare/FOFA/Grafana 等）
```

---

## 当前已实现

- [x] **Agent Core**：Event + Investigation + Event Router + 多轮 Agentic Loop
- [x] **LLM Engine**：OpenAI / Anthropic 兼容，Function Calling，SSE 流式输出
- [x] **Kubernetes 工具**：get_pods / get_pod_logs / describe_resource / get_events / get_node_status
- [x] **Skill 系统**：Agent 渐进式披露记忆，Level 1 自动注入 → Level 2/3 按需读取 → 排查后自动更新经验
- [x] **触发器**：UptimeKuma / AlertManager / Grafana / 通用 Webhook
- [x] **MCP Client**：外接 MCP Server 动态扩展工具（stdio + SSE + OAuth 2.1 PKCE）
- [x] **飞书机器人**：事件/调查通知推送 + 交互命令（调查列表/查看/事件列表）+ WebSocket 长连接
- [x] **专业 Dashboard**：节点状态 / 工作负载健康 / 异常 Pod / 命名空间资源 / Top 10 消耗
- [x] **Web 前端**：Chat 对话 / Events 列表+详情 / Investigation 管理 / Skill 浏览器 + Mermaid 图
- [x] **认证**：JWT + OAuth/OIDC（Authentik 等）
- [x] **零配置部署**：`kubectl apply -k` 一键安装，Web 内完成所有配置
- [x] **单镜像**：go:embed 前端静态文件，一个二进制搞定

---

## Skill 系统

Orca 的 Skill 系统是 Agent 的可进化记忆，遵循 [Anthropic Agent Skills](https://agentskills.io) 的渐进式披露设计：

```
Level 1 — 元数据（~80 tokens/skill）
  启动时注入所有 Agent 的 system prompt
  Agent 知道有哪些服务、什么场景该查哪个 skill

Level 2 — 完整文档
  Agent 调用 read_skill(name) 按需加载
  包含：服务概述、组件、排障手册、注意事项

Level 3 — 深度参考
  Agent 调用 read_skill_ref(name, ref) 加载
  包含：Mermaid 架构图、历史事件记录等
```

Agent 排查问题后自动调用 `update_skill_section` 积累经验，下次同类问题排查更快。

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
| K8s 指标 | k8s.io/metrics |
| 数据库 | PostgreSQL |
| K8s 交互 | client-go |
| 飞书 SDK | larksuite/oapi-sdk-go v3 |
| 代码高亮 | Shiki |
| 图表渲染 | Mermaid |
| 部署 | Kubernetes（单镜像 Deployment） |

---

## 文档

- [触发器配置指南](docs/triggers.md) — UptimeKuma / AlertManager / Grafana / 通用 Webhook
- [飞书机器人配置指南](docs/lark-bot.md) — 创建应用、事件订阅、交互命令
- [K8s ServiceAccount 配置](docs/serviceaccount.md)

---

## 开发路线

### Phase 2 — Agent Harness

- 多 Agent 协调：Supervisor Agent（分诊）+ Analysis Agent（排查）
- 工具执行审计（actions 表）
- 写操作权限 + 人工审批流（飞书回复恢复）
- 受限 Bash 工具（白名单 + 超时 + 审计）
- 定时巡检（Patrol）
- MCP Server（对外暴露 Agent 能力）

### Phase 3 — 团队协作

- 值班轮转排班 / 事件升级策略
- 事件交接 + LLM 自动摘要
- 自动 Postmortem

### Phase 4 — 高级特性

- 多集群支持 / Docker Compose 环境
- 自适应巡检频率
- 云厂商 MCP 接入 / Skill 市场

---

## License

MIT
