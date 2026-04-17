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

export interface ChatMessage {
  id: string
  conversation_id: string
  role: 'user' | 'assistant' | 'tool' | 'system'
  content: string
  tool_calls?: ToolCall[]
  tool_call_id?: string
  tool_name?: string
  created_at: string
}

export async function getStatus(): Promise<StatusResponse> {
  const res = await fetch('/api/status')
  if (!res.ok) throw new Error(`status: ${res.status}`)
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
  const res = await fetch('/api/conversations')
  if (!res.ok) throw new Error(`conversations: ${res.status}`)
  return res.json()
}

export async function getConversationMessages(id: string): Promise<ChatMessage[]> {
  const res = await fetch(`/api/conversations/${id}/messages`)
  if (!res.ok) throw new Error(`messages: ${res.status}`)
  return res.json()
}

export async function deleteConversation(id: string): Promise<void> {
  const res = await fetch(`/api/conversations/${id}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(`delete: ${res.status}`)
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
  const res = await fetch(`/api/investigations${qs ? '?' + qs : ''}`)
  if (!res.ok) throw new Error(`investigations: ${res.status}`)
  return res.json()
}

export async function getInvestigation(id: string): Promise<Investigation> {
  const res = await fetch(`/api/investigations/${id}`)
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
  const res = await fetch('/api/investigations', {
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
  const res = await fetch(`/api/investigations/${id}`, {
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
  const res = await fetch(`/api/investigations/${id}/archive`, { method: 'POST' })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error || `archive: ${res.status}`)
  }
  return res.json()
}

export async function unarchiveInvestigation(id: string): Promise<Investigation> {
  const res = await fetch(`/api/investigations/${id}/unarchive`, { method: 'POST' })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error || `unarchive: ${res.status}`)
  }
  return res.json()
}

export async function listInvestigationEntries(id: string): Promise<InvestigationEntry[]> {
  const res = await fetch(`/api/investigations/${id}/entries`)
  if (!res.ok) throw new Error(`entries: ${res.status}`)
  return res.json()
}

export async function createInvestigationEntry(
  id: string,
  body: { type: InvestigationEntryType; content: string },
): Promise<InvestigationEntry> {
  const res = await fetch(`/api/investigations/${id}/entries`, {
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

// ---- SSE streaming chat ----

export type ChatStreamEvent =
  | { type: 'message'; message: ChatMessage }
  | { type: 'done'; conversation_id: string; iterations: number }
  | { type: 'error'; error: string }

export interface StreamChatHandlers {
  onEvent: (ev: ChatStreamEvent) => void
  signal?: AbortSignal
}

/**
 * streamChat 通过 SSE 消费 /api/chat。
 * 后端帧格式: `event: <name>\ndata: <json>\n\n`
 * 可能的 event: "message" | "done" | "error"
 */
export async function streamChat(
  message: string,
  conversationId: string | null,
  { onEvent, signal }: StreamChatHandlers,
): Promise<void> {
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify({
      message,
      conversation_id: conversationId ?? '',
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
