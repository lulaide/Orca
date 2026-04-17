import { useState, useRef, useEffect, useMemo, type FormEvent } from 'react'
import { sendMessage, type ChatMessage } from '../api'
import { MessageBubble } from './MessageBubble'

export function ChatPanel() {
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  // tool_call_id -> output content
  const toolOutputs = useMemo(() => {
    const map: Record<string, string> = {}
    for (const m of messages) {
      if (m.role === 'tool' && m.tool_call_id) {
        map[m.tool_call_id] = m.content
      }
    }
    return map
  }, [messages])

  const handleNewChat = () => {
    if (loading) return
    setConversationId(null)
    setMessages([])
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    const text = input.trim()
    if (!text || loading) return

    // 乐观插入用户消息（用临时 id，后端返回后不再 reconciliate，留着就行）
    const tempUser: ChatMessage = {
      id: `temp-${Date.now()}`,
      conversation_id: conversationId ?? '',
      role: 'user',
      content: text,
      created_at: new Date().toISOString(),
    }
    setInput('')
    setMessages((prev) => [...prev, tempUser])
    setLoading(true)

    try {
      const res = await sendMessage(text, conversationId)
      setConversationId(res.conversation_id)
      setMessages((prev) => [...prev, ...res.new_messages])
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      setMessages((prev) => [
        ...prev,
        {
          id: `err-${Date.now()}`,
          conversation_id: conversationId ?? '',
          role: 'assistant',
          content: `Error: ${msg}`,
          created_at: new Date().toISOString(),
        },
      ])
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-slate-700 bg-slate-800/50">
        <span className="text-xs text-slate-500 font-mono truncate">
          {conversationId ? `conv: ${conversationId.slice(0, 8)}…` : 'new conversation'}
        </span>
        <button
          type="button"
          onClick={handleNewChat}
          disabled={loading || messages.length === 0}
          className="text-xs px-2 py-1 rounded border border-slate-600 text-slate-300
            hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          New chat
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {messages.length === 0 && (
          <div className="flex items-center justify-center h-full text-slate-500">
            <div className="text-center">
              <p className="text-lg mb-2">Ask Orca anything about your cluster</p>
              <p className="text-sm text-slate-600">
                Try: "Check the cluster health" or "List all pods in kube-system"
              </p>
            </div>
          </div>
        )}
        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} toolOutputs={toolOutputs} />
        ))}
        {loading && (
          <div className="flex justify-start mb-3">
            <div className="bg-slate-700 rounded-lg px-4 py-3 text-sm text-slate-400">
              <span className="inline-flex gap-1">
                <span className="animate-bounce" style={{ animationDelay: '0ms' }}>
                  .
                </span>
                <span className="animate-bounce" style={{ animationDelay: '150ms' }}>
                  .
                </span>
                <span className="animate-bounce" style={{ animationDelay: '300ms' }}>
                  .
                </span>
              </span>{' '}
              Thinking...
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <form onSubmit={handleSubmit} className="border-t border-slate-700 p-4">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about your cluster..."
            disabled={loading}
            className="flex-1 bg-slate-800 border border-slate-600 rounded-lg px-4 py-2.5
              text-sm text-slate-200 placeholder-slate-500
              focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500
              disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="px-5 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg
              hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed
              transition-colors"
          >
            Send
          </button>
        </div>
      </form>
    </div>
  )
}
