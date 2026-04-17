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

export interface ChatResponse {
  conversation_id: string
  reply: string
  iterations: number
  new_messages: ChatMessage[]
}

export async function getStatus(): Promise<StatusResponse> {
  const res = await fetch('/api/status')
  if (!res.ok) throw new Error(`status: ${res.status}`)
  return res.json()
}

export async function sendMessage(
  message: string,
  conversationId: string | null,
): Promise<ChatResponse> {
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message,
      conversation_id: conversationId ?? '',
    }),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error || `chat: ${res.status}`)
  }
  return res.json()
}
