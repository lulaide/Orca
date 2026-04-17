# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

仓库根目录 `../CLAUDE.md` 讲的是 Orca 整体（产品定位、后端架构、数据库 schema、路线图）。本文件只记录 **`frontend/` 子包独有的**、从代码本身不容易快速看出来的东西。

## 开发命令

```bash
npm run dev      # Vite dev server on :5173，默认假设后端在 :9000
npm run build    # tsc -b && vite build  → dist/
npm run lint     # eslint .
npm run preview  # 本地起 dist 预览
```

后端端口在 `vite.config.ts` 硬编码为 `http://localhost:9000`（代理 `/api` 和 `/healthz`）。后端如果换端口，这里要同步改。

**没有配置任何测试框架**。类型检查用 `npx tsc --noEmit`（build 会跑一次）。

React 19 + Vite 8 + Tailwind v4 + TypeScript（严格模式，在 `tsconfig.app.json`）。

## 状态流总览

整个前端只有一个 "页面"：左侧栏 + 聊天面板。没有路由库，路由是手写的。

```
App
├── parseConversationId(pathname) → 初始 conversationId
├── popstate listener → 同步浏览器前进后退
├── Sidebar
│   ├── listConversations() 按 refreshToken 重拉
│   ├── getStatus() 每 30s 轮询
│   └── onSelect(id) → App.handleSelect → history.pushState(/c/{id})
└── ChatPanel (key = conversationId 隐式；手动 useEffect 重载)
    ├── 挂载时 getConversationMessages(id) 还原
    ├── send(text) → streamChat(...) SSE 流式追加消息
    └── onConversationCreated(id) → App.handleConversationCreated → history.replaceState
```

**刷新状态维度**：`App` 里的 `refreshToken` 是个单调递增数；任何需要让 Sidebar 重拉会话列表的场景（发消息、创建、删除）都调 `bumpRefresh()`。Sidebar 用它作为 `useEffect` 的依赖。

## URL 持久化（没用 router 库）

- `/` → 新对话
- `/c/{id}` → 某个会话（`id` 通过正则 `/^\/c\/([A-Za-z0-9_-]{6,})$/` 匹配）
- 侧栏切换：`pushState` —— 历史里新增一条
- 首次发消息后端返回新 id：`replaceState` —— 不给"新对话"多一条历史项
- 浏览器前进后退：`popstate` 监听同步 state

**生产部署**需要静态服务器把 `/c/{uuid}` 重写到 `index.html`（nginx `try_files $uri /index.html;`）。Vite dev server 默认已启用此行为。

## SSE 流协议（`api.ts::streamChat`）

后端 `/api/chat` 返回 SSE，帧格式 `event: <name>\ndata: <json>\n\n`。三种 event：

- `message`：一条 `ChatMessage`（role ∈ user/assistant/tool），可能含 `tool_calls`（eino shape `{id, type, function:{name, arguments}}`）
- `done`：`{conversation_id, iterations}`，流结束标记
- `error`：`{error}`，错误文本

Reader 里维护 `buffer`，按 `\n\n` / `\r\n\r\n` 切帧，组件层只消费 `ChatStreamEvent` 联合类型。多行 `data:` 会被按规范 join 成单个 JSON 字符串。

## 消息渲染的轮次分组（ChatPanel + MessageBubble）

后端会把一轮 LLM 交互拆成多条 `messages` 入库（assistant → tool → assistant …），前端要把**连续的 assistant + tool** 折叠到一个"头像单元"下，对应 Claude web 的视觉。

- `groupIntoTurns(messages)` 在 ChatPanel 里；把连续 assistant 消息并到同一个 `Turn`
- 工具消息不独立显示，而是通过 `tool_call_id` 在 `toolOutputs` map 里被对应的 `ToolCallCard` 取用
- `system` 消息静默

## 选中消息 → 引用到下一轮（Reply 功能）

- 消息滚动容器的 `onMouseUp` 里读 `window.getSelection()`；要求选区 ancestor 含 `data-assistant-content`（标记在 `AssistantTurn`）
- 非空选区 → 记录文本和选区 `getBoundingClientRect()` → 渲染 `position: fixed` 的 Reply 按钮
- 点击按钮 → 写入 `quoteDraft` state（独立于 `input`，不塞进 textarea）
- 发送时 `send()` 把 `quoteDraft` 按 markdown blockquote (`> `) 拼到 `finalText` 前再走 SSE

滚动时 `popstate`-like 的监听会清空 `quoteSel`。

## 主题系统（Tailwind v4 `@theme`）

`index.css` 用 `@theme { ... }` 定义 light 色板；`[data-theme='dark'] { ... }` 是 dark 覆盖。组件里用 `bg-[var(--color-xxx)]` 语法直接引。

- `theme.ts` 只做 localStorage 读写 + `documentElement.setAttribute('data-theme', ...)`
- `main.tsx` 在 root render 前调 `applyTheme(getInitialTheme())`，避免 light→dark flash
- 切换由 Sidebar 底部按钮触发

**全局 `:focus-visible` 有一条 2px accent outline**（在 `index.css`），专门对 `textarea`/`input` 关掉，否则会在 composer 上出现奇怪的绿框 outline。

## 关键约定

- 字体从 Google Fonts 按需加载（`@import` 在 `index.css` 首行）：Geist Sans / Instrument Serif / JetBrains Mono。字重和 italic 变体要用到的话，**先确认 `@import` 里声明了对应值**
- `.orca-prose` 是自写的类 markdown 样式类；不要换回 `@tailwindcss/typography` 的 `prose` 类（`@tailwindcss/typography` 装了但没挂载使用）
- 所有"应用内"颜色都必须走 `var(--color-*)`；写死的 hex 只在 CSS token 定义里允许
- Tool 返回结果以 `"ERROR: "` 前缀代表失败（`ToolCallCard.tsx` 里硬编码），后端协议要保持一致
- 中文硬编码是刻意的（暂不做 i18n），copy 直接写字面量；`index.html` 的 `lang="zh-CN"`
