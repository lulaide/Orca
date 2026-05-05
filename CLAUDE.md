# Orca 项目上下文

## 这是什么

Orca 是一个开源的 AI 运维 Agent，部署在 Kubernetes 集群内部，提供 7×24 自动值守、智能排障和团队协作。核心思路是事件驱动——任何异常信号（监控告警、CI/CD 失败、定时巡检发现问题）都会变成一个事件，Agent 自动用 LLM + 工具调用进行根因分析，然后通过 IM 群和 Web 界面通知运维团队。

和现有工具的区别：PagerDuty 只做告警通知不排查原因，HolmesGPT 会排查但没有团队协作和事件追踪，Kubiya 有 Agent 能力但闭源且贵。Orca 把 AI 排查 + 事件追踪 + 团队分工 + 知识积累统一在一个开源平台里。

---

## 技术栈

- 后端：Go
- 前端：React
- 数据库：PostgreSQL（Phase 2 起加 pgvector 扩展做向量检索，MVP 阶段不启用）
- K8s 交互：client-go（in-cluster + kubeconfig 自动 fallback）
- LLM 接入：OpenAI-compatible API（支持 Ollama / OpenAI / DeepSeek / 任何兼容端点）
- Embedding：all-MiniLM-L6-v2（本地 ONNX 推理，Phase 2 起使用）
- IM Bot：平台 SDK，按需接入（Phase 1 任选一个实现，后续可扩展 QQ / Telegram / 飞书等）
- MCP 协议：Go 实现，对外暴露 Agent 能力 + 对外调用外部 MCP Server
- 认证：OAuth 2.0 / OIDC，对接内部自定义认证后端（Authentik 或类似）
- 实时通信：WebSocket
- 部署：Kubernetes 集群内（Deployment + ServiceAccount + RBAC）

---

## 架构概览

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
├── 事件路由器 ← 接收所有触发源的事件，分类分发
├── 调查管理器 ← 管理 Investigation 会话状态和对话历史
├── LLM 推理引擎 ← Agentic Loop + Function Calling，多轮工具调用
└── Skill 系统 ← Agent 渐进式记忆（按服务组织，Level 1/2/3 披露）
        │
        ├── 触发插件（输入）
        │   ├── UptimeKuma Webhook
        │   ├── Prometheus AlertManager Webhook
        │   ├── Grafana Webhook
        │   ├── CI/CD Webhook（GitHub Actions / Gitea Actions 等）
        │   ├── 定时巡检（Cron + LLM prompt）
        │   ├── 用户请求（IM / Web）
        │   └── 通用 Webhook（用户自定义解析）
        │
        └── 工具层（执行）
            ├── 原生 SDK：client-go 直接调 K8s API（get/describe/logs/restart/scale/delete）
            ├── 受限 Bash：白名单命令（curl/dig/ping/gh/traceroute），30s 超时，10KB 截断
            └── MCP 客户端：外部扩展（FOFA/Cloudflare/Grafana/云厂商/文档源）
                    │
                    ▼
             Kubernetes 集群
```

---

## 核心概念

### Event（事件）

每个异常信号或用户请求的抽象。字段：id, source, severity(critical/warning/info), title, payload(JSON), related_services, created_at。

### Conversation（对话）

所有聊天的通用容器。用户通过 ASK 发起对话,对话中可以引用/创建 Investigation。字段：id(uuid), title, created_at, updated_at。对话消息存在 messages 表（conversation_id, role, content）。

### Investigation（调查）

一个独立的资源,代表**一个待解决的问题**。不绑定到某个特定对话——多个对话可以引用同一个 Investigation,一个对话也可以涉及多个 Investigation（多对多关系,通过 conversation_investigations 表关联）。

创建方式：事件触发自动创建 / AI 在 ASK 对话中发现问题后调工具创建 / 用户手动创建。

字段：id, title, description, status(open/investigating/resolved/stale), severity(critical/warning/info), source, event_id, related_services(JSONB), root_cause, solution, created_at, updated_at, resolved_at。

Investigation 有时间线日志（investigation_entries 表），记录每一步发现、操作和结论,类似 Statuspage 的事件更新流。

resolved 时 LLM 自动填充 root_cause + solution,存入记忆供后续检索。

### Trigger Plugin（触发插件）

统一接口，每个告警源实现 `Start(ctx, eventCh)` 方法。Webhook 类插件共享一个 HTTP 路由 `/api/webhooks/{plugin_name}`，每个端点带 secret token 验证。

### Patrol（自动巡检）

定时触发的无症状 Investigation。不写检查规则，写自然语言 prompt，LLM 自主决定调用什么工具、怎么判断。配置是 YAML：name + cron schedule + prompt + severity_threshold。结果是结构化 JSON：status(healthy/warning/critical) + findings[] + summary。healthy 静默记日志，warning/critical 生成 Event。

### Skill（技能系统）

Agent 的可进化记忆单元，遵循 Anthropic Agent Skills 的渐进式披露设计。每个 Skill 代表 Agent 对一个服务/组件的全部认知。

**渐进式披露三层：**
- **Level 1**（~80 tokens/skill）：name + description，启动时自动注入所有 Agent 的 system prompt
- **Level 2**：SKILL.md body（<5000 tokens），Agent 调用 `read_skill(name)` 按需加载
- **Level 3**：references（架构图、历史事件等），Agent 调用 `read_skill_ref(name, ref)` 深度加载

**进化循环：**
- Knowledge Agent 扫描集群 → 创建/更新 Skill（write_skill）
- Analyst Agent 排查问题 → 读取 Skill（read_skill）→ 按 playbook 排查
- Investigation resolved → Agent 更新 Skill（update_skill_section）→ 积累经验
- 下次同类问题 → Agent 读到新经验 → 更快解决

**数据模型：** skills 表（name PK, description, content, references JSONB, metadata JSONB）

**工具：**
- 所有 Agent：read_skill / read_skill_ref / update_skill_section
- Knowledge Agent：write_skill / write_skill_ref / delete_skill

### Tool Layer（工具层）

两层：
1. 原生 SDK（client-go + k8s.io/metrics）：K8s 只读诊断（get_pods / get_pod_logs / describe_resource / get_events / get_node_status）
2. MCP 客户端：外部系统扩展，用户在 Web 配置连接（Cloudflare / FOFA 等）

---

## 用户模型

单租户多用户：一个 Orca 实例管一套集群，多个运维人员按模块分工。

users 表：id, name, avatar, provider, provider_id, role(admin/member), modules(JSONB, 如 ["api-gateway","database"]), im_id, created_at。

认证通过 OAuth 2.0 / OIDC 接入内部自定义认证后端。Web 和 MCP Server 共用同一套认证。

权限：admin 可执行所有操作。member 对自己负责模块可执行低风险写操作（如 rollout restart），高风险写操作（如 delete pod）需 admin 确认。

---

## 交互层

### Web 前端 (React)

页面：Dashboard（集群概览+巡检状态+事件统计）、Events（事件列表+筛选）、Investigation（单事件对话记录+审计）、Chat（自由对话）、Knowledge（服务编辑+Runbook 上传+记忆查看）、Patrol（巡检配置+历史报告）、Settings（插件/MCP/用户/LLM 配置）。

WebSocket 实时推送事件和 Investigation 更新，Agent 推理过程流式输出。

### IM 机器人

群聊：事件通知发群 + @ 模块负责人，reply 自动关联 Investigation。命令：/ask, /approve, /status, /mute。
私聊：独立对话，记录归个人。
通知策略：critical = 群通知+@+私聊值班人，warning = 仅群通知，info = 静默。

### MCP Server

暴露的 Tools：cluster_query, cluster_logs, investigation_list, investigation_detail, knowledge_search, memory_search, cluster_execute, patrol_status。HTTP 层 OAuth 认证。

---

## 数据库设计（PostgreSQL）

下面是完整目标 schema。按阶段划分：

- **Phase 1 (MVP)**：users / conversations / messages / investigations / investigation_entries / conversation_investigations / events / actions / services / patrol_configs / patrol_logs / plugin_configs / settings
- **Phase 2**：knowledge（带 embedding）+ `CREATE EXTENSION vector` + ivfflat 索引，mcp_connections

MVP 阶段 **不创建** knowledge 表、**不安装** pgvector 扩展。待 Phase 2 做记忆/RAG 时再 `ALTER` 引入，避免过早引入依赖。

```sql
-- 用户
CREATE TABLE users (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    avatar          TEXT,
    provider        TEXT,
    provider_id     TEXT,
    role            TEXT DEFAULT 'member',
    modules         JSONB,
    im_id           TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- 事件
CREATE TABLE events (
    id              TEXT PRIMARY KEY,
    source          TEXT NOT NULL,
    severity        TEXT NOT NULL,
    title           TEXT NOT NULL,
    payload         JSONB,
    related_services JSONB,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- 对话容器（ASK 和 Investigation 共用）
CREATE TABLE conversations (
    id              TEXT PRIMARY KEY,       -- uuid
    title           TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- 对话消息
CREATE TABLE messages (
    id                  TEXT PRIMARY KEY,
    conversation_id     TEXT REFERENCES conversations(id),
    role                TEXT NOT NULL,       -- 'user' | 'assistant'
    content             TEXT NOT NULL,
    created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- 调查（独立资源,不绑定到特定对话）
CREATE TABLE investigations (
    id              TEXT PRIMARY KEY,
    title           TEXT NOT NULL,
    description     TEXT,
    status          TEXT DEFAULT 'open',        -- 'open' | 'investigating' | 'resolved' | 'stale'
    severity        TEXT DEFAULT 'info',        -- 'critical' | 'warning' | 'info'
    source          TEXT,                       -- 'uptime-kuma' | 'patrol' | 'ask' | 'manual'
    event_id        TEXT,
    related_services JSONB,
    root_cause      TEXT,                       -- resolved 时填
    solution        TEXT,                       -- resolved 时填
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    resolved_at     TIMESTAMPTZ
);

-- 调查时间线日志
CREATE TABLE investigation_entries (
    id                  TEXT PRIMARY KEY,
    investigation_id    TEXT REFERENCES investigations(id),
    type                TEXT NOT NULL,       -- 'discovery' | 'action' | 'resolution' | 'note'
    content             TEXT NOT NULL,
    author              TEXT,               -- 'ai' | user_id
    created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- 对话与调查的多对多关联
CREATE TABLE conversation_investigations (
    conversation_id     TEXT REFERENCES conversations(id),
    investigation_id    TEXT REFERENCES investigations(id),
    PRIMARY KEY (conversation_id, investigation_id)
);

-- Agent 操作审计
CREATE TABLE actions (
    id                  TEXT PRIMARY KEY,
    conversation_id     TEXT REFERENCES conversations(id),
    user_id             TEXT,
    tool_name           TEXT NOT NULL,
    tool_input          JSONB,
    tool_output         TEXT,
    approved            BOOLEAN,
    created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- 运行时设置（LLM / K8s 等运行时配置持久化）
CREATE TABLE settings (
    key             TEXT PRIMARY KEY,
    value           JSONB NOT NULL,
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_by      TEXT
);

-- 服务清单（自动采集 + 人工维护）
CREATE TABLE services (
    name                TEXT PRIMARY KEY,
    namespace           TEXT,
    deployment          TEXT,
    description         TEXT,
    owner               TEXT,
    repo                TEXT,
    notes               TEXT,
    image               TEXT,
    ports               JSONB,
    domains             JSONB,
    status              TEXT,
    pod_count           INTEGER,
    auto_discovered     BOOLEAN DEFAULT true,
    updated_at          TIMESTAMPTZ DEFAULT NOW()
);

-- 知识库（记忆 + Runbook + 文档）
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE knowledge (
    id              TEXT PRIMARY KEY,
    type            TEXT NOT NULL,           -- 'memory' | 'runbook' | 'doc'
    title           TEXT,
    content         TEXT NOT NULL,
    metadata        JSONB,
    contributed_by  TEXT,
    embedding       VECTOR(384),
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX ON knowledge USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- 巡检配置
CREATE TABLE patrol_configs (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    schedule        TEXT NOT NULL,           -- cron 表达式
    prompt          TEXT NOT NULL,
    severity_threshold TEXT DEFAULT 'warning',
    enabled         BOOLEAN DEFAULT true,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- 巡检日志
CREATE TABLE patrol_logs (
    id              TEXT PRIMARY KEY,
    patrol_id       TEXT REFERENCES patrol_configs(id),
    status          TEXT NOT NULL,           -- 'healthy' | 'warning' | 'critical'
    report          JSONB,
    event_id        TEXT,                    -- 如果生成了事件则关联
    executed_at     TIMESTAMPTZ DEFAULT NOW()
);

-- 插件配置
CREATE TABLE plugin_configs (
    id              TEXT PRIMARY KEY,
    plugin_name     TEXT NOT NULL,
    config          JSONB,
    secret_token    TEXT,
    enabled         BOOLEAN DEFAULT true,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- MCP 连接配置
CREATE TABLE mcp_connections (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    url             TEXT NOT NULL,
    auth_type       TEXT,                   -- 'bearer' | 'basic' | 'none'
    auth_token      TEXT,
    description     TEXT,
    enabled         BOOLEAN DEFAULT true,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);
```

---

## 项目结构

前后端分离,各自独立目录,独立构建。

```
orca/
├── backend/                            # Go 后端
│   ├── cmd/
│   │   └── orca/
│   │       └── main.go                 # 入口，初始化各模块并启动
│   ├── internal/
│   │   ├── config/
│   │   │   └── config.go               # 配置定义 + YAML 加载
│   │   ├── core/
│   │   │   ├── event.go                # Event 数据模型 + 创建/查询
│   │   │   ├── investigation.go        # Investigation 管理 + 状态机
│   │   │   └── router.go               # Event Router，接收事件并分发
│   │   ├── llm/
│   │   │   ├── provider.go             # Provider 工厂（eino ChatModel，支持 OpenAI/Anthropic）
│   │   │   └── engine.go               # Agentic Loop + Context 组装
│   │   ├── agents/
│   │   │   ├── explorer.go             # Explorer Agent（只读诊断）
│   │   │   ├── generator.go            # Generator Agent（生成结构化方案）
│   │   │   ├── evaluator.go            # Evaluator Agent（方案评审 + 修复验证）
│   │   │   ├── executor.go             # Executor（解析 actions，通过 registry 执行）
│   │   │   ├── pipeline.go             # SolutionPipeline / ExecutionPipeline 循环
│   │   │   ├── hooks.go                # 状态变更回调注册
│   │   │   └── context.go              # 从时间线组装 Agent 上下文
│   │   ├── tools/
│   │   │   ├── registry.go             # Tool 注册表（权限自查 + 动态注册）
│   │   │   └── kubernetes.go           # K8s 只读工具（client-go）
│   │   ├── kube/
│   │   │   └── client.go               # K8s 客户端初始化（in-cluster + kubeconfig fallback）
│   │   ├── triggers/
│   │   │   ├── plugin.go               # TriggerPlugin 接口定义
│   │   │   ├── uptimekuma.go           # UptimeKuma Webhook 处理
│   │   │   ├── alertmanager.go         # AlertManager Webhook 处理（Phase 2）
│   │   │   ├── cicd.go                 # CI/CD Webhook 处理（Phase 2）
│   │   │   ├── patrol.go               # 定时巡检执行器
│   │   │   └── user.go                 # 用户请求（从 API 层转入的消息）
│   │   ├── knowledge/
│   │   │   ├── service_discovery.go    # 自动采集 K8s 集群服务信息
│   │   │   └── store.go                # 知识库 CRUD（services 表）
│   │   ├── auth/
│   │   │   ├── oauth.go                # OAuth 2.0 / OIDC 流程
│   │   │   ├── middleware.go           # 认证中间件（JWT 校验）
│   │   │   └── permission.go           # 权限校验（admin/member + 模块匹配）
│   │   ├── bot/
│   │   │   ├── bot.go                  # IM Bot 抽象接口
│   │   │   └── notification.go         # 通知策略（severity → 通知方式）
│   │   ├── api/
│   │   │   ├── server.go               # HTTP 服务器 + 路由
│   │   │   ├── events.go               # /api/events 相关接口
│   │   │   ├── investigations.go       # /api/investigations 相关接口
│   │   │   ├── chat.go                 # /api/chat 对话接口
│   │   │   ├── knowledge.go            # /api/knowledge 知识库接口
│   │   │   ├── patrol.go               # /api/patrol 巡检接口
│   │   │   ├── webhooks.go             # /api/webhooks/* Webhook 入口
│   │   │   ├── settings.go             # /api/settings 配置接口
│   │   │   └── ws.go                   # WebSocket 推送
│   │   └── db/
│   │       └── db.go                   # PostgreSQL 连接（GORM）+ AutoMigrate
│   ├── config.yaml                     # 运行时配置模板
│   ├── go.mod
│   └── go.sum
├── frontend/                           # React 前端
│   ├── src/
│   │   ├── pages/                      # Dashboard, Events, Investigation, Chat, Knowledge, Patrol, Settings
│   │   ├── components/
│   │   └── api/                        # 后端 API 调用封装
│   └── package.json
├── deploy/
│   ├── kubernetes/                     # K8s 部署清单（Deployment, Service, RBAC, ConfigMap）
│   └── docker-compose.yml              # 本地开发用
├── docs/                               # 项目文档
└── README.md
```

---

## 关键实现细节

### Agentic Loop

LLM 返回 tool_call → 执行工具 → 结果追加到 messages → 再次调用 LLM → 可能继续 tool_call → ... → 最终返回文本。就是一个 for 循环，最多迭代 10 轮防止无限循环。

```go
func (e *Engine) Run(ctx context.Context, systemPrompt string, userMessage string, tools []Tool) (string, error) {
    messages := []Message{
        {Role: "system", Content: systemPrompt},
        {Role: "user", Content: userMessage},
    }
    for i := 0; i < 10; i++ {
        resp, err := e.chat(ctx, messages, tools)
        if err != nil { return "", err }
        if resp.Content != "" {
            return resp.Content, nil // 得出结论
        }
        if resp.ToolCalls != nil {
            for _, call := range resp.ToolCalls {
                result := e.executeTool(ctx, call)
                messages = append(messages, assistantToolCallMsg(call), toolResultMsg(call.ID, result))
            }
            continue
        }
        return resp.Content, nil
    }
    return "达到最大迭代次数，未能得出结论", nil
}
```

### 服务自动采集

Agent 启动时和之后每 5 分钟，用 client-go 扫描集群：遍历 namespace → list Deployments/StatefulSets/DaemonSets → 关联 Services → 关联 Ingresses → 写入 services 表。使用 UPSERT，只更新自动采集字段（image/status/ports/domains/pod_count），不覆盖人工字段（description/owner/repo/notes）。已消失的服务标记 status='gone'，7 天后删除。

### 受限 Bash

白名单机制：维护一个允许的命令前缀列表和一个禁止的模式列表。执行前先校验。超时 30 秒，输出截断 10KB，所有执行写入 actions 表做审计。

### 巡检

一个 goroutine 运行 cron scheduler，到时间了从 patrol_configs 表读配置，组装 system prompt + patrol prompt，调用 Agentic Loop。输出要求是 JSON 格式（status + findings[] + summary）。根据 severity_threshold 决定是否生成 Event。

### IM 群发

事件生成时，查 services 表找到 related_services 的 owner，查 users 表找到 im_id，在群里发送事件通知并 @ 对应用户。每条通知消息记录 message_id，用户 reply 时通过 reply_to_message_id 关联到 Investigation。

### 写操作审批

LLM 决定执行写操作（如 delete pod）时，不直接执行，而是：1) 发消息到 IM 群和 Web 前端，说明要执行什么操作；2) 等用户 /approve 或在 Web 点确认；3) 确认后执行并记录到 actions 表。低风险写操作（rollout restart）模块负责人可直接确认，高风险写操作需 admin。

---

## 开发路线

### Phase 1 — MVP（当前阶段，已完成）

1. **Agent Core**：Event + Investigation + Event Router + 多轮 Agentic Loop
2. **LLM Engine**：OpenAI / Anthropic 兼容，Function Calling，SSE 流式输出
3. **K8s 只读工具**：get_pods / get_pod_logs / describe_resource / get_events / get_node_status + k8s.io/metrics
4. **K8s 写操作**：restart / scale / delete_pod / rollback / cordon / uncordon（需 Chat 内审批）
5. **Bash 工具**：任意 shell 命令执行（需 Chat 内审批），AI 自主设置超时
6. **审批系统**：PendingAction + SSE 推送审批卡片 + ToolCallCard 内嵌确认/拒绝
7. **Skill 系统**：渐进式披露记忆（Level 1/2/3），Knowledge Agent 扫描生成，Chat Agent 持续学习
8. **Skill 安装**：兼容 SKILL.md 开放标准，go-git 内存 clone，GitHub 仓库安装
9. **触发器**：UptimeKuma / AlertManager / Grafana / 通用 Webhook
10. **定时巡检**：Cron 调度 + 自然语言 prompt + 独立 Agent Loop + 飞书巡检报告
11. **飞书机器人**：事件/调查/巡检通知推送 + 交互命令 + WebSocket 长连接
12. **专业 Dashboard**：节点状态 / 工作负载 / 异常 Pod / 命名空间资源 / Top 10
13. **Web 前端**：Chat（消息操作 + Token 显示）/ Events（平铺式）/ Investigation / Skill 浏览器 + Mermaid / 代码高亮
14. **认证**：JWT + OAuth/OIDC（Authentik 等）
15. **MCP Client**：外接 MCP Server（stdio + SSE + OAuth 2.1 PKCE）
16. **Token 追踪**：每条消息记录 prompt/completion/cached tokens
17. **零配置部署**：kubectl apply -k 一键安装，单镜像（go:embed），移动端适配

### Phase 2 — Agent Harness（进行中）

- [x] 多 Agent 排障流水线（Explorer → Generator → Evaluator），Investigation 状态驱动
- [x] 结构化方案执行：submit_solution + Executor 通过 registry.Execute 调用内置工具
- [x] 飞书交互卡片审批（确认/拒绝 + 拒绝原因 + 卡片动态更新）
- [x] get_node_status 集成 metrics 实时 CPU/内存
- [x] orca-operator ClusterRole（写操作 RBAC 权限）
- IM Bot AI 对话（飞书群内直接排障）
- 工具执行审计 + Token 成本统计面板
- MCP Server（对外暴露 Agent 能力）
- CEL 规则引擎（告警过滤 / 关联 / 去重）

### Phase 3 — 团队协作

- 值班轮转排班
- 事件升级策略
- 事件交接 + LLM 自动摘要
- 自动 Postmortem
- 巡检 Dashboard

### Phase 4 — 高级特性

- 多集群支持
- Docker Compose 环境支持
- 自适应巡检频率
- 云厂商 MCP 接入
- Skill 市场 / 社区插件