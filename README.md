<div align="center">

# Orca

> 事件驱动的 AI 运维 Agent，为 Kubernetes 集群提供 7×24 自动值守、智能排障和团队协作。

<p>
  <img src="https://img.shields.io/badge/Go-1.26.1-00ADD8?style=flat-square&logo=go&logoColor=white" alt="Go 1.26.1">
  <img src="https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=black" alt="React 19">
  <img src="https://img.shields.io/badge/Vite-8-646CFF?style=flat-square&logo=vite&logoColor=white" alt="Vite 8">
  <img src="https://img.shields.io/badge/Kubernetes-native-326CE5?style=flat-square&logo=kubernetes&logoColor=white" alt="Kubernetes native">
  <a href="https://deepwiki.com/lulaide/Orca"><img src="https://deepwiki.com/badge.svg" alt="Ask DeepWiki"></a>
</p>

</div>

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

1. **异常发现**：插件化告警源接入 + 定时巡检，第一时间感知异常
2. **智能排障**：LLM 驱动的 Agentic Loop，自主调用工具链进行根因分析，支持写操作 + 人工审批
3. **知识积累**：Skill 系统持续学习排障经验，Agent 越用越聪明

和现有工具的区别：PagerDuty 只做告警通知不排查原因，HolmesGPT 会排查但没有团队协作和知识积累，Kubiya 有 Agent 能力但闭源且贵。Orca 把 AI 排查 + 事件追踪 + 知识积累 + 写操作审批统一在一个开源平台里。

---

## 架构总览

```
用户交互层
├── Web 前端 (React) ─────────┐
├── 飞书机器人（通知+交互）─────┤
└── OAuth / SSO ───────────────┤
                                ▼
                     REST API + SSE
                                │
                                ▼
Agent Core
├── 事件路由器 ← 告警源事件分发
├── 巡检调度器 ← Cron 定时主动检查
├── LLM 推理引擎 ← Agentic Loop + Function Calling
├── 审批管理器 ← 写操作人工确认
└── Skill 系统 ← Agent 渐进式记忆（按服务组织，持续学习）
        │
        ├── 触发插件（输入）
        │   ├── UptimeKuma / AlertManager / Grafana Webhook
        │   ├── 通用 Webhook（自定义解析）
        │   ├── 定时巡检（Cron + 自然语言 prompt）
        │   └── 用户请求（Web 对话 / 飞书命令）
        │
        └── 工具层（执行）
            ├── K8s 只读：get_pods / logs / describe / events / node_status
            ├── K8s 写操作：restart / scale / delete_pod / rollback / cordon（需审批）
            ├── Bash：任意 shell 命令（需审批）
            ├── Skill：read_skill / update_skill_section（知识读写）
            └── MCP 客户端：外部扩展（Cloudflare / FOFA / Grafana 等）
```

---

## 已实现功能

### Agent 核心

- [x] **多 Agent 流水线**：Explorer（诊断）→ Generator（方案）→ Evaluator（评审+验证），状态驱动自动流转
- [x] **Agentic Loop**：多轮 Function Calling，最多 20 轮迭代，SSE 流式输出
- [x] **LLM Engine**：OpenAI / Anthropic 兼容，运行时热切换
- [x] **Token 追踪**：每条消息记录输入/输出/缓存 token 消耗

### Kubernetes 工具

- [x] **只读诊断**：get_pods / get_pod_logs / describe_resource / get_events / get_node_status（含 metrics 实时 CPU/内存）
- [x] **写操作（需审批）**：restart_deployment / scale_deployment / delete_pod / rollback_deployment / cordon_node / uncordon_node
- [x] **结构化执行**：submit_solution 工具生成结构化 actions，Executor 通过 registry 直接调用（不依赖 kubectl 二进制）
- [x] **Bash（需审批）**：任意 shell 命令，AI 自主设置超时，输出截断 10KB
- [x] **Metrics**：k8s.io/metrics 集群指标采集

### 审批系统

- [x] **Chat 内审批**：写操作自动弹确认/拒绝卡片，用户点击后 Agent 继续执行
- [x] **飞书交互审批**：方案评审通过后推送交互卡片，支持确认/拒绝（带拒绝原因），点击后卡片自动更新
- [x] **Investigation 审批**：多 Agent 流水线的 awaiting_approval 状态，Web + 飞书双通道审批
- [x] **SSE 实时推送**：审批请求通过 SSE 推给前端，ToolCallCard 内嵌审批按钮
- [x] **审计记录**：PendingAction 表记录所有写操作审批状态

### Skill 系统

- [x] **渐进式披露**：Level 1 自动注入 → Level 2 按需读取 → Level 3 深度参考
- [x] **持续学习**：Chat Agent 对话中学到知识自动更新 Skill
- [x] **Skill 安装**：兼容 [SKILL.md 开放标准](https://agentskills.io)，从 GitHub 仓库安装社区技能
- [x] **Knowledge Agent**：扫描集群自动生成服务文档 + Mermaid 架构图

### 事件与巡检

- [x] **触发器**：UptimeKuma / AlertManager / Grafana / 通用 Webhook
- [x] **事件路由**：告警自动触发 Agent 排查，创建 Investigation 跟踪
- [x] **定时巡检**：Cron 调度 + 自然语言 prompt，Agent 自主检查集群健康
- [x] **巡检通知**：飞书推送巡检报告（正常/发现问题/失败）

### Dashboard

- [x] **集群资源**：CPU / 内存 / Pod 环形图，四档渐变配色
- [x] **节点状态**：每节点 CPU / 内存进度条 + 异常条件标签
- [x] **工作负载健康**：Deployment / StatefulSet / DaemonSet 就绪/降级/不可用
- [x] **异常 Pod**：CrashLoopBackOff / ImagePullBackOff / Pending / 高重启
- [x] **命名空间资源分布** + **CPU / 内存 Top 10**

### 飞书机器人

- [x] **通知推送**：事件 / 调查创建 / 调查解决 / 巡检报告 / 方案审批
- [x] **交互卡片**：方案审批带确认/拒绝按钮 + 拒绝原因输入框，操作后卡片自动更新
- [x] **交互命令**：调查列表 / 查看详情 / 事件列表 / 帮助
- [x] **WebSocket 长连接**：消息事件 + 卡片回调均走长连接，无需公网回调 URL

### 前端

- [x] **Chat 对话**：消息操作（复制 / 重新生成）+ Token 显示 + Investigation 引用
- [x] **事件详情**：平铺式 Agent 处理过程展示
- [x] **Investigation 详情**：流水线进度条 + 方案审批 UI + 排查报告/修复方案/评审/验证 timeline
- [x] **Skill 浏览器**：Tab 切换概述 / References / Scripts + Mermaid 渲染
- [x] **代码高亮**：Shiki 语法高亮 + 复制按钮
- [x] **移动端适配**：底部导航栏 + 面板切换

### 部署与认证

- [x] **零配置部署**：`kubectl apply -k` 一键安装
- [x] **单镜像**：go:embed 前端静态文件
- [x] **认证**：JWT + OAuth/OIDC（Authentik 等）
- [x] **MCP Client**：stdio + SSE + OAuth 2.1 PKCE

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
| Git 操作 | go-git（纯 Go，无需系统 git） |
| K8s 指标 | k8s.io/metrics |
| 数据库 | PostgreSQL |
| K8s 交互 | client-go |
| 飞书 SDK | larksuite/oapi-sdk-go v3 |
| 调度 | robfig/cron/v3 |
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

- [x] 多 Agent 排障流水线（Explorer → Generator → Evaluator）
- [x] 飞书交互卡片审批（确认/拒绝 + 卡片动态更新）
- IM Bot AI 对话（飞书群内直接排障）
- 工具执行审计 + Token 成本统计面板
- MCP Server（对外暴露 Agent 能力）
- CEL 规则引擎（告警过滤 / 关联 / 去重）

### Phase 3 — 团队协作

- 值班轮转排班 / 事件升级策略
- 事件交接 + LLM 自动摘要
- 自动 Postmortem

### Phase 4 — 高级特性

- 多集群支持 / Docker Compose 环境
- 自适应巡检频率
- 云厂商 MCP 接入

---

## License

MIT
