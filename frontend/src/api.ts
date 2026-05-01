// ---- Auth ----

const TOKEN_KEY = 'orca_token'

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function setToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token)
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY)
}

/** 自动带 Authorization header 的 fetch */
export function authFetch(url: string, init?: RequestInit): Promise<Response> {
  const token = getToken()
  const headers = new Headers(init?.headers)
  if (token) headers.set('Authorization', `Bearer ${token}`)
  return fetch(url, { ...init, headers })
}

export interface AuthStatus {
  initialized: boolean
  oauth_enabled?: boolean
  oauth_provider_name?: string
  user?: { id: string; username: string; role: string }
}

export interface OAuthConfig {
  enabled: boolean
  provider_name: string
  issuer_url: string
  client_id: string
  client_secret?: string
  scopes: string
  default_role: string
}

export async function getOAuthConfig(): Promise<OAuthConfig> {
  const res = await authFetch('/api/auth/oauth/config')
  if (!res.ok) throw new Error(`oauth config: ${res.status}`)
  return res.json()
}

export async function setOAuthConfig(config: OAuthConfig): Promise<void> {
  const res = await authFetch('/api/auth/oauth/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error((err as { error?: string }).error || `save oauth: ${res.status}`)
  }
}

export async function getAuthStatus(): Promise<AuthStatus> {
  const token = getToken()
  const headers: Record<string, string> = {}
  if (token) headers['Authorization'] = `Bearer ${token}`
  const res = await authFetch('/api/auth/status', { headers })
  if (!res.ok) throw new Error(`auth status: ${res.status}`)
  return res.json()
}

export async function setupAdmin(username: string, password: string, baseUrl?: string): Promise<{ token: string }> {
  const res = await fetch('/api/auth/setup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password, base_url: baseUrl }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error((err as { error?: string }).error || `setup: ${res.status}`)
  }
  return res.json()
}

export async function login(username: string, password: string): Promise<{ token: string }> {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error((err as { error?: string }).error || `login: ${res.status}`)
  }
  return res.json()
}

// ---- Status ----

export interface StatusResponse {
  llm: {
    provider: string
    model: string
    endpoint: string
    max_iterations: number
    configured: boolean
    last_error: string
    configured_at: string
  }
  kubernetes: {
    mode: string
    connected: boolean
    server_version: string
    last_error: string
    connected_at: string
  }
  tools: string[]
}

// eino ToolCall shape
export interface ToolCall {
  id: string
  type: string
  function: {
    name: string
    arguments: string // raw JSON string from LLM
  }
}

// 被引用的 investigation 摘要，存在 message.metadata 里，用户 bubble 上方渲染卡片。
export interface ReferencedInvestigation {
  id: string
  title: string
  severity: InvestigationSeverity
  status: InvestigationStatus
}

export interface ChatMessageMetadata {
  referenced_investigations?: ReferencedInvestigation[]
}

export interface ChatMessage {
  id: string
  conversation_id: string
  role: 'user' | 'assistant' | 'tool' | 'system'
  content: string
  tool_calls?: ToolCall[]
  tool_call_id?: string
  tool_name?: string
  metadata?: ChatMessageMetadata
  created_at: string
}

export async function getStatus(): Promise<StatusResponse> {
  const res = await authFetch('/api/status')
  if (!res.ok) throw new Error(`status: ${res.status}`)
  return res.json()
}

// ---- Settings: LLM ----

export interface LLMSettingsInput {
  provider: string
  endpoint?: string
  api_key: string
  model: string
  max_iterations?: number
}

export async function updateLLMSettings(body: LLMSettingsInput): Promise<StatusResponse['llm']> {
  const res = await authFetch('/api/settings/llm', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error || `update llm: ${res.status}`)
  }
  return res.json()
}

export async function testLLMConnection(): Promise<{ ok: boolean; reply?: string; error?: string }> {
  const res = await authFetch('/api/settings/llm/test', { method: 'POST' })
  return res.json()
}

// ---- Settings: Kubernetes ----

export async function connectKubeInCluster(): Promise<StatusResponse['kubernetes']> {
  const res = await authFetch('/api/settings/kubernetes/in-cluster', { method: 'POST' })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error || `in-cluster: ${res.status}`)
  }
  return res.json()
}

export async function uploadKubeconfig(content: string): Promise<StatusResponse['kubernetes']> {
  const res = await authFetch('/api/settings/kubernetes/kubeconfig', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error || `kubeconfig: ${res.status}`)
  }
  return res.json()
}

export async function disconnectKube(): Promise<StatusResponse['kubernetes']> {
  const res = await authFetch('/api/settings/kubernetes', { method: 'DELETE' })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error || `disconnect kube: ${res.status}`)
  }
  return res.json()
}

// ---- Cluster metrics (Lens 风格 CPU/Memory/Pods 三卡) ----

export interface ClusterMetrics {
  cpu: {
    usage: number | null      // cores
    requests: number
    limits: number
    allocatable: number
    capacity: number
  }
  memory: {
    usage: number | null      // bytes
    requests: number
    limits: number
    allocatable: number
    capacity: number
  }
  pods: {
    usage: number
    allocatable: number
    capacity: number
  }
  nodes: { total: number; ready: number }
  metrics_available: boolean
}

export async function getClusterMetrics(): Promise<ClusterMetrics> {
  const res = await authFetch('/api/cluster/metrics')
  if (!res.ok) throw new Error(`cluster/metrics: ${res.status}`)
  return res.json()
}

// ---- Cluster Overview (enhanced dashboard) ----

export interface NodeDetail {
  name: string
  cpu_usage: number | null
  cpu_allocatable: number
  cpu_capacity: number
  mem_usage: number | null
  mem_allocatable: number
  mem_capacity: number
  pod_count: number
  pod_capacity: number
  ready: boolean
  conditions: string[]
}

export interface NamespaceSummary {
  name: string
  pod_count: number
  cpu_requests: number
  cpu_limits: number
  mem_requests: number
  mem_limits: number
}

export interface PodResource {
  name: string
  namespace: string
  cpu: number
  memory: number
}

export interface WorkloadCounts {
  total: number
  ready: number
  degraded: number
  unavailable: number
}

export interface WorkloadHealth {
  deployments: WorkloadCounts
  statefulsets: WorkloadCounts
  daemonsets: WorkloadCounts
}

export interface ProblemPod {
  name: string
  namespace: string
  reason: string
  restarts: number
  message: string
  age: string
}

export interface ClusterOverview extends ClusterMetrics {
  node_details: NodeDetail[]
  namespaces: NamespaceSummary[]
  top_pods_cpu: PodResource[]
  top_pods_memory: PodResource[]
  workloads: WorkloadHealth
  problem_pods: ProblemPod[]
}

export async function getClusterOverview(): Promise<ClusterOverview> {
  const res = await authFetch('/api/cluster/overview')
  if (!res.ok) throw new Error(`cluster/overview: ${res.status}`)
  return res.json()
}

// ---- Conversations ----

export interface Conversation {
  id: string
  title: string
  created_at: string
  updated_at: string
}

export async function listConversations(): Promise<Conversation[]> {
  const res = await authFetch('/api/conversations')
  if (!res.ok) throw new Error(`conversations: ${res.status}`)
  return res.json()
}

export async function getConversationMessages(id: string): Promise<ChatMessage[]> {
  const res = await authFetch(`/api/conversations/${id}/messages`)
  if (!res.ok) throw new Error(`messages: ${res.status}`)
  return res.json()
}

export async function forkConversation(id: string): Promise<Conversation> {
  const res = await authFetch(`/api/conversations/${id}/fork`, { method: 'POST' })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error((err as { error?: string }).error || `fork: ${res.status}`)
  }
  return res.json()
}

export async function deleteConversation(id: string): Promise<void> {
  const res = await authFetch(`/api/conversations/${id}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(`delete: ${res.status}`)
}

// 列出本对话已关联的 investigations（顶部 chip bar 用）
export async function listConversationInvestigations(convId: string): Promise<Investigation[]> {
  const res = await authFetch(`/api/conversations/${convId}/investigations`)
  if (!res.ok) throw new Error(`conversation investigations: ${res.status}`)
  return res.json()
}

// 解除对话与某 investigation 的关联（不删 investigation 本体）
export async function unlinkInvestigationFromConversation(convId: string, invId: string): Promise<void> {
  const res = await authFetch(`/api/conversations/${convId}/investigations/${invId}`, { method: 'DELETE' })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error || `unlink: ${res.status}`)
  }
}

// ---- Investigations ----

export type InvestigationStatus = 'open' | 'investigating' | 'resolved' | 'stale'
export type InvestigationSeverity = 'critical' | 'warning' | 'info'
export type InvestigationView = 'active' | 'resolved' | 'archived' | 'all'
export type InvestigationEntryType = 'discovery' | 'action' | 'resolution' | 'note'

export interface Investigation {
  id: string
  title: string
  description: string
  status: InvestigationStatus
  severity: InvestigationSeverity
  source: string
  event_id?: string | null
  related_services?: string[]
  root_cause?: string
  solution?: string
  archived_at?: string | null
  created_at: string
  updated_at: string
  resolved_at?: string | null
}

export interface InvestigationEntry {
  id: string
  investigation_id: string
  type: InvestigationEntryType
  content: string
  author: string
  created_at: string
}

export interface ListInvestigationsOpts {
  view?: InvestigationView
  conversationId?: string
  status?: string
}

export async function listInvestigations(opts: ListInvestigationsOpts = {}): Promise<Investigation[]> {
  const params = new URLSearchParams()
  if (opts.view) params.set('view', opts.view)
  if (opts.conversationId) params.set('conversation_id', opts.conversationId)
  if (opts.status) params.set('status', opts.status)
  const qs = params.toString()
  const res = await authFetch(`/api/investigations${qs ? '?' + qs : ''}`)
  if (!res.ok) throw new Error(`investigations: ${res.status}`)
  return res.json()
}

export async function getInvestigation(id: string): Promise<Investigation> {
  const res = await authFetch(`/api/investigations/${id}`)
  if (!res.ok) throw new Error(`investigation: ${res.status}`)
  return res.json()
}

export interface CreateInvestigationInput {
  title: string
  description?: string
  severity?: InvestigationSeverity
  source?: string
  related_services?: string[]
}

export async function createInvestigation(body: CreateInvestigationInput): Promise<Investigation> {
  const res = await authFetch('/api/investigations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error || `create investigation: ${res.status}`)
  }
  return res.json()
}

export interface UpdateInvestigationPatch {
  title?: string
  description?: string
  status?: InvestigationStatus
  severity?: InvestigationSeverity
  root_cause?: string
  solution?: string
}

export async function updateInvestigation(id: string, patch: UpdateInvestigationPatch): Promise<Investigation> {
  const res = await authFetch(`/api/investigations/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error || `update investigation: ${res.status}`)
  }
  return res.json()
}

export async function archiveInvestigation(id: string): Promise<Investigation> {
  const res = await authFetch(`/api/investigations/${id}/archive`, { method: 'POST' })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error || `archive: ${res.status}`)
  }
  return res.json()
}

export async function unarchiveInvestigation(id: string): Promise<Investigation> {
  const res = await authFetch(`/api/investigations/${id}/unarchive`, { method: 'POST' })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error || `unarchive: ${res.status}`)
  }
  return res.json()
}

export async function listInvestigationEntries(id: string): Promise<InvestigationEntry[]> {
  const res = await authFetch(`/api/investigations/${id}/entries`)
  if (!res.ok) throw new Error(`entries: ${res.status}`)
  return res.json()
}

// ---- Events ----

export interface OrcaEvent {
  id: string
  source: string
  severity: InvestigationSeverity
  title: string
  payload: unknown
  related_services?: string[]
  dedup_key?: string
  processed_at?: string | null
  agent_summary?: string
  conversation_id?: string
  created_at: string
}

export interface ListEventsOpts {
  source?: string
  severity?: string
  processed?: boolean
  limit?: number
}

export async function listEvents(opts: ListEventsOpts = {}): Promise<OrcaEvent[]> {
  const params = new URLSearchParams()
  if (opts.source) params.set('source', opts.source)
  if (opts.severity) params.set('severity', opts.severity)
  if (opts.processed !== undefined) params.set('processed', opts.processed ? 'true' : 'false')
  if (opts.limit) params.set('limit', String(opts.limit))
  const qs = params.toString()
  const res = await authFetch(`/api/events${qs ? '?' + qs : ''}`)
  if (!res.ok) throw new Error(`events: ${res.status}`)
  return res.json()
}

export interface EventDetail {
  event: OrcaEvent
  investigations: Investigation[]
}

export async function getEvent(id: string): Promise<EventDetail> {
  const res = await authFetch(`/api/events/${id}`)
  if (!res.ok) throw new Error(`event: ${res.status}`)
  return res.json()
}

// ---- Plugins ----

export interface PluginInfo {
  name: string
  description: string
  configured: boolean
  enabled: boolean
  has_token: boolean
  webhook_url?: string
}

export async function listPlugins(): Promise<PluginInfo[]> {
  const res = await authFetch('/api/plugins')
  if (!res.ok) throw new Error(`plugins: ${res.status}`)
  return res.json()
}

export interface PluginTokenInfo {
  plugin: string
  secret_token: string
  enabled: boolean
}

export async function enablePlugin(name: string): Promise<void> {
  const res = await authFetch(`/api/plugins/${name}/enable`, { method: 'POST' })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error || `enable: ${res.status}`)
  }
}

export async function disablePlugin(name: string): Promise<void> {
  const res = await authFetch(`/api/plugins/${name}/disable`, { method: 'POST' })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error || `disable: ${res.status}`)
  }
}

export async function regeneratePluginToken(name: string): Promise<PluginTokenInfo> {
  const res = await authFetch(`/api/plugins/${name}/regenerate-token`, { method: 'POST' })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error || `regenerate token: ${res.status}`)
  }
  return res.json()
}

export async function getPluginToken(name: string): Promise<PluginTokenInfo | null> {
  const res = await authFetch(`/api/plugins/${name}/token`)
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`plugin token: ${res.status}`)
  return res.json()
}

export async function createInvestigationEntry(
  id: string,
  body: { type: InvestigationEntryType; content: string },
): Promise<InvestigationEntry> {
  const res = await authFetch(`/api/investigations/${id}/entries`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error || `create entry: ${res.status}`)
  }
  return res.json()
}

// ---- Knowledge Pages ----

export interface KnowledgePage {
  slug: string
  title: string
  content: string
  parent_slug: string
  sort_order: number
  updated_at: string
}

export interface ScanStreamEvent {
  type: 'message' | 'done' | 'error'
  data: unknown
}

export async function listKnowledgePages(): Promise<KnowledgePage[]> {
  const res = await authFetch('/api/knowledge/pages')
  if (!res.ok) throw new Error(`pages: ${res.status}`)
  return res.json()
}

export async function getKnowledgePage(slug: string): Promise<KnowledgePage> {
  const res = await authFetch(`/api/knowledge/pages/${slug}`)
  if (!res.ok) throw new Error(`page: ${res.status}`)
  return res.json()
}

export async function updateKnowledgePage(slug: string, content: string): Promise<KnowledgePage> {
  const res = await authFetch(`/api/knowledge/pages/${slug}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  })
  if (!res.ok) throw new Error(`update page: ${res.status}`)
  return res.json()
}

/** 启动扫描（POST），返回后通过 streamScanProgress 订阅进度 */
export async function startScan(): Promise<{ status: string }> {
  const res = await authFetch('/api/knowledge/scan', { method: 'POST' })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error((err as { error?: string }).error || `scan: ${res.status}`)
  }
  return res.json()
}

/** SSE 订阅扫描进度（GET），支持重连回放历史。返回 abort 函数 */
export function streamScanProgress(handlers: {
  onMessage: (msg: Record<string, unknown>) => void
  onDone: (summary: string) => void
  onError: (err: string) => void
  onNoScan?: () => void
}): { abort: () => void } {
  const ctrl = new AbortController()

  authFetch('/api/knowledge/scan/stream', {
    headers: { Accept: 'text/event-stream' },
    signal: ctrl.signal,
  }).then(async (res) => {
    if (res.status === 204) {
      handlers.onNoScan?.()
      return
    }
    if (!res.ok || !res.body) {
      const body = await res.json().catch(() => ({}))
      handlers.onError((body as { error?: string }).error || `scan: ${res.status}`)
      return
    }
    const reader = res.body.getReader()
    const decoder = new TextDecoder('utf-8')
    let buffer = ''

    const handleFrame = (frame: string) => {
      let event = 'message'
      const dataLines: string[] = []
      for (const rawLine of frame.split('\n')) {
        const line = rawLine.replace(/\r$/, '')
        if (!line || line.startsWith(':')) continue
        const idx = line.indexOf(':')
        const field = idx === -1 ? line : line.slice(0, idx)
        const value = idx === -1 ? '' : line.slice(idx + 1).replace(/^ /, '')
        if (field === 'event') event = value
        else if (field === 'data') dataLines.push(value)
      }
      if (dataLines.length === 0) return
      let data: unknown
      try { data = JSON.parse(dataLines.join('\n')) } catch { return }

      if (event === 'message') handlers.onMessage(data as Record<string, unknown>)
      else if (event === 'done') handlers.onDone((data as { summary?: string }).summary || '')
      else if (event === 'error') handlers.onError((data as { error?: string }).error || 'unknown')
    }

    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let sep: number
      while ((sep = buffer.indexOf('\n\n')) !== -1) {
        const frame = buffer.slice(0, sep)
        buffer = buffer.slice(sep + 2)
        if (frame.length > 0) handleFrame(frame)
      }
    }
    if (buffer.trim()) handleFrame(buffer.trim())
  }).catch((err) => {
    if ((err as { name?: string })?.name !== 'AbortError') {
      handlers.onError(err instanceof Error ? err.message : 'network error')
    }
  })

  return { abort: () => ctrl.abort() }
}

// ---- Skills ----

export interface Skill {
  name: string
  type: string              // "service" | "installed" | "custom"
  source: string            // installed: "github:owner/repo/path"
  description: string
  content: string
  references: Record<string, string>
  scripts: Record<string, string>
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
}

export async function listSkills(): Promise<Skill[]> {
  const res = await authFetch('/api/skills')
  if (!res.ok) throw new Error(`skills: ${res.status}`)
  return res.json()
}

export async function getSkill(name: string): Promise<Skill> {
  const res = await authFetch(`/api/skills/${name}`)
  if (!res.ok) throw new Error(`skill: ${res.status}`)
  return res.json()
}

export async function updateSkill(name: string, patch: { description?: string; content?: string }): Promise<Skill> {
  const res = await authFetch(`/api/skills/${name}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
  if (!res.ok) throw new Error(`update skill: ${res.status}`)
  return res.json()
}

export async function deleteSkill(name: string): Promise<void> {
  const res = await authFetch(`/api/skills/${name}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(`delete skill: ${res.status}`)
}

export async function getSkillRef(name: string, ref: string): Promise<string> {
  const res = await authFetch(`/api/skills/${name}/refs/${ref}`)
  if (!res.ok) throw new Error(`skill ref: ${res.status}`)
  const data = await res.json()
  return data.content
}

export async function updateSkillRef(name: string, ref: string, content: string): Promise<void> {
  const res = await authFetch(`/api/skills/${name}/refs/${ref}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  })
  if (!res.ok) throw new Error(`update skill ref: ${res.status}`)
}

// ---- Skill 安装 ----

export interface DiscoveredSkill {
  name: string
  description: string
  content: string
  frontmatter: Record<string, string>
  refs: Record<string, string>
  scripts: Record<string, string>
  path: string
  installed: boolean
}

export interface ScanRepoResult {
  repo: string
  count: number
  skills: DiscoveredSkill[]
}

export async function scanRepo(repo: string): Promise<ScanRepoResult> {
  const res = await authFetch('/api/skills/scan-repo', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ repo }),
  })
  if (!res.ok) throw new Error(`scan repo: ${res.status}`)
  return res.json()
}

export async function installSkillsFromRepo(repo: string, skills: { name: string; path: string }[]): Promise<{ installed: string[]; errors: string[] }> {
  const res = await authFetch('/api/skills/install', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ repo, skills }),
  })
  if (!res.ok) throw new Error(`install skills: ${res.status}`)
  return res.json()
}

export async function uninstallSkill(name: string): Promise<void> {
  const res = await authFetch(`/api/skills/uninstall/${name}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(`uninstall skill: ${res.status}`)
}

// ---- Patrol ----

export interface PatrolConfig {
  id: string
  name: string
  schedule: string
  prompt: string
  severity: string
  enabled: boolean
  last_run_at: string | null
  created_at: string
  updated_at: string
}

export interface PatrolRun {
  id: string
  patrol_id: string
  conversation_id: string
  status: string
  summary: string
  duration: number
  error: string
  created_at: string
}

export async function listPatrols(): Promise<PatrolConfig[]> {
  const res = await authFetch('/api/patrols')
  if (!res.ok) throw new Error(`patrols: ${res.status}`)
  return res.json()
}

export async function getPatrol(id: string): Promise<PatrolConfig> {
  const res = await authFetch(`/api/patrols/${id}`)
  if (!res.ok) throw new Error(`patrol: ${res.status}`)
  return res.json()
}

export async function createPatrol(data: { name: string; schedule: string; prompt: string; severity: string }): Promise<PatrolConfig> {
  const res = await authFetch('/api/patrols', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error(`create patrol: ${res.status}`)
  return res.json()
}

export async function updatePatrol(id: string, data: Record<string, unknown>): Promise<PatrolConfig> {
  const res = await authFetch(`/api/patrols/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error(`update patrol: ${res.status}`)
  return res.json()
}

export async function deletePatrol(id: string): Promise<void> {
  const res = await authFetch(`/api/patrols/${id}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(`delete patrol: ${res.status}`)
}

export async function runPatrol(id: string): Promise<void> {
  const res = await authFetch(`/api/patrols/${id}/run`, { method: 'POST' })
  if (!res.ok) throw new Error(`run patrol: ${res.status}`)
}

export async function listPatrolRuns(id: string): Promise<PatrolRun[]> {
  const res = await authFetch(`/api/patrols/${id}/runs`)
  if (!res.ok) throw new Error(`patrol runs: ${res.status}`)
  return res.json()
}

// ---- MCP Connections ----

export type MCPTransport = 'stdio' | 'sse'
export type MCPAuthType = 'none' | 'bearer' | 'oauth'
export type MCPStatus = 'connected' | 'disconnected' | 'disabled' | 'needs_auth' | 'error'

export interface MCPConnectionInfo {
  id: string
  name: string
  transport: MCPTransport
  command?: string
  args?: string[]
  env?: Record<string, string>
  url?: string
  auth_type?: MCPAuthType
  oauth_client_id?: string
  oauth_scopes?: string
  description?: string
  enabled: boolean
  status: MCPStatus
  tools: string[]
  created_at: string
  updated_at: string
}

export interface CreateMCPConnectionInput {
  name: string
  transport: MCPTransport
  command?: string
  args?: string[]
  env?: Record<string, string>
  url?: string
  auth_type?: MCPAuthType
  auth_token?: string
  oauth_client_id?: string
  oauth_client_secret?: string
  oauth_scopes?: string
  headers?: Record<string, string>
  description?: string
}

export async function listMCPConnections(): Promise<MCPConnectionInfo[]> {
  const res = await authFetch('/api/mcp/connections')
  if (!res.ok) throw new Error(`mcp connections: ${res.status}`)
  return res.json()
}

export async function createMCPConnection(body: CreateMCPConnectionInput): Promise<MCPConnectionInfo> {
  const res = await authFetch('/api/mcp/connections', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error || `create mcp connection: ${res.status}`)
  }
  return res.json()
}

export async function updateMCPConnection(id: string, patch: Record<string, unknown>): Promise<MCPConnectionInfo> {
  const res = await authFetch(`/api/mcp/connections/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error || `update mcp connection: ${res.status}`)
  }
  return res.json()
}

export async function deleteMCPConnection(id: string): Promise<void> {
  const res = await authFetch(`/api/mcp/connections/${id}`, { method: 'DELETE' })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error || `delete mcp connection: ${res.status}`)
  }
}

export async function reconnectMCPConnection(id: string): Promise<{ tools: string[] }> {
  const res = await authFetch(`/api/mcp/connections/${id}/reconnect`, { method: 'POST' })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error || `reconnect: ${res.status}`)
  }
  return res.json()
}

export async function getMCPOAuthURL(id: string): Promise<{ authorize_url?: string; status?: string }> {
  const res = await authFetch(`/api/mcp/connections/${id}/oauth/authorize`)
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error || `oauth authorize: ${res.status}`)
  }
  return res.json()
}

// ---- SSE streaming chat ----

export type ChatStreamEvent =
  | { type: 'message'; message: ChatMessage }
  | { type: 'done'; conversation_id: string; iterations: number }
  | { type: 'error'; error: string }

export interface StreamChatHandlers {
  onEvent: (ev: ChatStreamEvent) => void
  signal?: AbortSignal
  // 本轮用户消息引用的 investigation id 列表（顺序无关，后端去重）
  referencedInvestigationIDs?: string[]
}

/**
 * streamChat 通过 SSE 消费 /api/chat。
 * 后端帧格式: `event: <name>\ndata: <json>\n\n`
 * 可能的 event: "message" | "done" | "error"
 */
export async function streamChat(
  message: string,
  conversationId: string | null,
  { onEvent, signal, referencedInvestigationIDs }: StreamChatHandlers,
): Promise<void> {
  const res = await authFetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify({
      message,
      conversation_id: conversationId ?? '',
      referenced_investigation_ids: referencedInvestigationIDs ?? [],
    }),
    signal,
  })
  if (!res.ok || !res.body) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error || `chat: ${res.status}`)
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''

  // 处理一个完整的 SSE 帧（以 \n\n 分隔）。
  const handleFrame = (frame: string) => {
    let event = 'message'
    const dataLines: string[] = []
    for (const rawLine of frame.split('\n')) {
      const line = rawLine.replace(/\r$/, '')
      if (!line) continue
      if (line.startsWith(':')) continue // SSE 注释
      const idx = line.indexOf(':')
      const field = idx === -1 ? line : line.slice(0, idx)
      const value = idx === -1 ? '' : line.slice(idx + 1).replace(/^ /, '')
      if (field === 'event') event = value
      else if (field === 'data') dataLines.push(value)
    }
    if (dataLines.length === 0) return
    const dataStr = dataLines.join('\n')
    let data: unknown
    try {
      data = JSON.parse(dataStr)
    } catch {
      return
    }

    if (event === 'message') {
      onEvent({ type: 'message', message: data as ChatMessage })
    } else if (event === 'done') {
      const d = data as { conversation_id: string; iterations: number }
      onEvent({ type: 'done', conversation_id: d.conversation_id, iterations: d.iterations })
    } else if (event === 'error') {
      const d = data as { error?: string }
      onEvent({ type: 'error', error: d.error ?? 'unknown error' })
    }
  }

  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    // SSE 帧以 \n\n 分隔（规范也允许 \r\n\r\n）。
    let sep: number
    while ((sep = buffer.indexOf('\n\n')) !== -1 || (sep = buffer.indexOf('\r\n\r\n')) !== -1) {
      const boundary = buffer.indexOf('\n\n') !== -1 ? 2 : 4
      const frame = buffer.slice(0, sep)
      buffer = buffer.slice(sep + boundary)
      if (frame.length > 0) handleFrame(frame)
    }
  }
  // flush 尾部未以 \n\n 结束的帧（正常情况下后端每次都带结束符，这里兜底）
  const tail = buffer.trim()
  if (tail) handleFrame(tail)
}
