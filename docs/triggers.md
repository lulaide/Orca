# 触发器配置指南

Orca 通过 Webhook 触发器接收外部告警源的通知，自动创建事件并启动 AI Agent 排查。

## 通用配置流程

所有触发器的配置流程一致：

1. 在 Orca Web 界面 → **触发器** 页面，找到对应的触发器并点击 **启用**
2. 启用后会自动生成一个 **Secret Token**，点击复制
3. 在告警源中配置 Webhook，填入 Orca 的 Webhook URL 和 Token
4. 发送测试告警验证连通性

### 认证方式

所有 Webhook 端点统一使用自定义请求头认证：

```
X-Orca-Token: <你的 Secret Token>
```

不使用 Basic Auth 或 Bearer Token。

### 去重机制

同一告警在 **60 秒内** 重复触发会被自动去重，不会创建重复事件。

---

## Uptime Kuma

监控站点可用性，当站点 DOWN 时触发事件。

### Webhook URL

```
https://<你的 Orca 地址>/api/webhooks/uptime-kuma
```

### Uptime Kuma 配置步骤

1. 进入 Uptime Kuma → **设置** → **通知**
2. 点击 **设置通知** → 选择类型 **Webhook**
3. 填写配置：
   - **友好名称**：`Orca`
   - **URL**：`https://<你的 Orca 地址>/api/webhooks/uptime-kuma`
   - **请求头**：添加一行
     ```
     X-Orca-Token: <你的 Token>
     ```
4. 点击 **测试** 验证，然后 **保存**
5. 在需要监控的项目中启用该通知

### 行为说明

- 仅 **DOWN（状态码 0）** 会创建事件，UP / PENDING / MAINTENANCE 会被忽略
- 严重度固定为 `critical`
- Uptime Kuma 每秒发送心跳，Orca 会自动去重（60 秒窗口）

---

## Prometheus AlertManager

接收 Prometheus AlertManager 的告警通知。

### Webhook URL

```
https://<你的 Orca 地址>/api/webhooks/alertmanager
```

### AlertManager 配置步骤

在 AlertManager 配置文件 `alertmanager.yml` 中添加 Webhook Receiver：

```yaml
receivers:
  - name: 'orca'
    webhook_configs:
      - url: 'https://<你的 Orca 地址>/api/webhooks/alertmanager'
        http_config:
          headers:
            X-Orca-Token: '<你的 Token>'
        send_resolved: true  # 可选，resolved 状态会被 Orca 忽略

route:
  receiver: 'orca'           # 默认接收器
  # 或者按规则路由：
  routes:
    - match:
        severity: critical
      receiver: 'orca'
```

修改配置后重新加载 AlertManager：

```bash
# 热重载
curl -X POST http://localhost:9093/-/reload

# 或重启
kubectl rollout restart deployment/alertmanager -n monitoring
```

### 行为说明

- 仅 **firing** 状态创建事件，`resolved` 会被忽略
- 严重度映射：`critical` / `error` → 严重，`warning` / `warn` → 警告，其他 → 信息
- 如果一次推送包含多条告警，取第一条，标题中标注 "+N others"
- 去重键：`alertmanager:{alertname}:{fingerprint}`

### 推荐的告警 Labels

Orca 会自动提取以下 Labels 来丰富事件信息：

| Label | 用途 |
|-------|------|
| `alertname` | 事件标题 |
| `severity` | 严重度映射 |
| `namespace` | 标题中显示，帮助定位 |
| `service` | 关联服务（优先） |
| `job` | 关联服务（备选） |

Annotations 中的 `summary` 和 `description` 会被提取到事件标题中。

---

## Grafana

接收 Grafana Alerting 的告警通知。

### Webhook URL

```
https://<你的 Orca 地址>/api/webhooks/grafana
```

### Grafana 配置步骤

1. 进入 Grafana → **警报** → **联络点**
2. 点击 **添加联络点**
3. 填写配置：
   - **名称**：`Orca`
   - **集成**：选择 `Webhook`
   - **URL**：`https://<你的 Orca 地址>/api/webhooks/grafana`
   - **HTTP Method**：选择 `POST`
4. 展开 **可选 Webhook 设置**：
   - **HTTP Basic Authentication**：留空（不使用）
   - **Authorization Header**：留空（不使用）
   - **Extra Headers**：点击 **+ 添加**
     - **Key**：`X-Orca-Token`
     - **Value**：`<你的 Token>`
   - 其他字段保持默认
5. 点击 **测试** 验证，然后 **保存**
6. 在 **通知策略** 中将该联络点设为接收器

### 行为说明

- 仅 **firing** 状态创建事件，`resolved` 会被忽略
- 严重度映射：`critical` / `error` → 严重，`warning` / `warn` → 警告，**默认 → 警告**
- 去重键：`grafana:{alertname}:{fingerprint}`
- Grafana 的 `dashboardURL` 和 `panelURL` 会被保留在事件 payload 中

### 推荐的告警 Labels

与 AlertManager 类似，Orca 自动提取 `alertname`、`severity`、`namespace`、`service`、`job` 等 Labels。

---

## 通用 Webhook

接收任意 JSON 格式的告警，适用于没有专用触发器的告警源（如自研监控、CI/CD 系统等）。

### Webhook URL

```
https://<你的 Orca 地址>/api/webhooks/generic
```

### 请求格式

发送 `POST` 请求，Body 为任意 JSON 对象。Orca 会自动从常见字段名中提取信息：

```bash
curl -X POST https://<你的 Orca 地址>/api/webhooks/generic \
  -H "Content-Type: application/json" \
  -H "X-Orca-Token: <你的 Token>" \
  -d '{
    "title": "数据库连接池耗尽",
    "severity": "critical",
    "service": "api-gateway",
    "id": "evt-12345",
    "detail": "连接数已达上限 200/200，新请求被拒绝"
  }'
```

### 字段自动提取

Orca 按优先级依次尝试提取以下字段（取第一个非空值）：

| 用途 | 尝试的字段名（按优先级） |
|------|------------------------|
| **标题** | `title` → `subject` → `name` → `message` → `msg` → `text` → `alert` → `summary` |
| **严重度** | `severity` → `level` → `priority` → `status` |
| **关联服务** | `service` → `app` → `application` → `source` → `project` → `repo` |
| **去重 ID** | `id` → `event_id` → `alert_id` → `fingerprint` → `dedup_key` |

### 严重度映射

| 原始值 | 映射结果 |
|--------|---------|
| `critical` / `error` / `fatal` / `emergency` | 严重 |
| `warning` / `warn` | 警告 |
| 其他 / 未指定 | 信息 |

大小写不敏感。

### 行为说明

- **所有请求都会创建事件**（不像其他触发器会过滤 resolved 状态）
- 如果没有匹配到标题字段，默认使用 "Generic Webhook 事件"
- 整个 JSON body 会被完整保存到事件 payload 中，Agent 排查时可查看

### 使用场景示例

- 自研监控系统的告警推送
- CI/CD Pipeline 失败通知
- 定时脚本检测到异常
- 第三方 SaaS 的 Webhook 转发

---

## Token 管理

### 查看 Token

在 Orca Web 界面 → **触发器** 页面，点击已启用的触发器可查看当前 Token。

### 轮换 Token

如果 Token 泄露，在触发器页面点击 **重新生成** 按钮。旧 Token 立即失效，需要同步更新告警源中的配置。

### 禁用触发器

在触发器页面点击 **禁用**，该触发器的 Webhook 端点会返回 401，不再接收告警。已有的事件和调查不受影响。
