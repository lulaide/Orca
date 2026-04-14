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

export interface ChatResponse {
  reply: string
  iterations: number
}

export async function getStatus(): Promise<StatusResponse> {
  const res = await fetch('/api/status')
  if (!res.ok) throw new Error(`status: ${res.status}`)
  return res.json()
}

export async function sendMessage(message: string): Promise<ChatResponse> {
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error || `chat: ${res.status}`)
  }
  return res.json()
}
