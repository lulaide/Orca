import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { streamChat, type ChatMessage } from '../api'
import { UserMessage, AssistantTurn } from './MessageBubble'

type Turn =
  | { kind: 'user'; message: ChatMessage }
  | { kind: 'assistant'; messages: ChatMessage[] }

function groupIntoTurns(messages: ChatMessage[]): Turn[] {
  const turns: Turn[] = []
  for (const m of messages) {
    if (m.role === 'user') {
      turns.push({ kind: 'user', message: m })
    } else if (m.role === 'assistant') {
      const last = turns[turns.length - 1]
      if (last && last.kind === 'assistant') last.messages.push(m)
      else turns.push({ kind: 'assistant', messages: [m] })
    }
  }
  return turns
}

interface Props {
  investigationId: string
  investigationTitle?: string
  onClose: () => void
}

/**
 * 详情页右侧的迷你聊天抽屉。
 * 内部维护独立会话（conversationId 初态 null，首条消息后由后端回填）。
 * 首条消息前会自动拼上当前 investigation 的标题/ID 作为 context。
 */
export function InvestigationChatDrawer({ investigationId, investigationTitle, onClose }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [conversationId, setConversationId] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  // 首条消息时才需要 prefix context
  const firstSentRef = useRef(false)

  // investigation 切换时重置所有状态（不太可能在抽屉内切，但兜一下）
  useEffect(() => {
    abortRef.current?.abort()
    setMessages([])
    setLoading(false)
    setConversationId(null)
    firstSentRef.current = false
  }, [investigationId])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  useEffect(() => {
    const ta = textareaRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = Math.min(ta.scrollHeight, 160) + 'px'
  }, [input])

  const toolOutputs = useMemo(() => {
    const map: Record<string, string> = {}
    for (const m of messages) {
      if (m.role === 'tool' && m.tool_call_id) map[m.tool_call_id] = m.content
    }
    return map
  }, [messages])

  const turns = useMemo(() => groupIntoTurns(messages), [messages])

  const send = async (text: string) => {
    if (!text || loading) return
    let finalText = text
    if (!firstSentRef.current) {
      const title = investigationTitle || '未命名调查'
      finalText = `> 当前调查：${title} (investigation ${investigationId})\n\n${text}`
      firstSentRef.current = true
    }
    setInput('')
    setLoading(true)
    const ctrl = new AbortController()
    abortRef.current = ctrl
    let createdId: string | null = null

    try {
      await streamChat(finalText, conversationId, {
        signal: ctrl.signal,
        onEvent: (ev) => {
          if (ev.type === 'message') {
            setMessages((prev) => [...prev, ev.message])
            if (!conversationId && !createdId && ev.message.conversation_id) {
              createdId = ev.message.conversation_id
            }
          } else if (ev.type === 'done') {
            if (createdId) setConversationId(createdId)
          } else if (ev.type === 'error') {
            setMessages((prev) => [
              ...prev,
              {
                id: `err-${Date.now()}`,
                conversation_id: conversationId ?? createdId ?? '',
                role: 'assistant',
                content: `出错：${ev.error}`,
                created_at: new Date().toISOString(),
              },
            ])
          }
        },
      })
    } catch (err: unknown) {
      if ((err as { name?: string })?.name !== 'AbortError') {
        const msg = err instanceof Error ? err.message : '未知错误'
        setMessages((prev) => [
          ...prev,
          {
            id: `err-${Date.now()}`,
            conversation_id: conversationId ?? createdId ?? '',
            role: 'assistant',
            content: `出错：${msg}`,
            created_at: new Date().toISOString(),
          },
        ])
      }
    } finally {
      setLoading(false)
      if (abortRef.current === ctrl) abortRef.current = null
    }
  }

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    void send(input.trim())
  }

  const handleKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void send(input.trim())
    }
  }

  const showEmpty = messages.length === 0 && !loading

  return (
    <div className="flex flex-col h-full min-h-0 bg-[var(--color-bg)]">
      {/* Strip */}
      <div className="flex items-center justify-between px-3 h-9 border-b border-[var(--color-border)] font-mono text-[11px]">
        <div className="flex items-center gap-1.5 text-[var(--color-text-dim)]">
          <span className="text-[var(--color-accent)]">✦</span>
          <span>assistant</span>
          {conversationId && (
            <>
              <span>·</span>
              <span className="text-[var(--color-text-muted)]">sess.{conversationId.slice(0, 6)}</span>
            </>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="w-6 h-6 grid place-items-center rounded
            text-[var(--color-text-dim)] hover:text-[var(--color-text)]
            hover:bg-[var(--color-surface-2)] transition-colors"
          aria-label="关闭"
        >
          <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto orca-grid">
        <div className="px-3 py-4">
          {showEmpty && (
            <div className="orca-fade-in text-[12.5px] text-[var(--color-text-dim)] leading-relaxed">
              <p className="mb-1 text-[var(--color-text-muted)]">基于当前调查问点什么？</p>
              <p>
                首条问题会自动带上调查标题作为上下文。之后的消息在同一会话里继续追问。
              </p>
            </div>
          )}
          {turns.map((t) =>
            t.kind === 'user' ? (
              <UserMessage key={t.message.id} message={t.message} />
            ) : (
              <AssistantTurn
                key={t.messages[0].id}
                messages={t.messages}
                toolOutputs={toolOutputs}
              />
            ),
          )}
          {loading && turns[turns.length - 1]?.kind === 'user' && (
            <div className="flex items-center gap-2 text-[11.5px] font-mono text-[var(--color-text-dim)] pl-4">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-[var(--color-accent)] orca-pulse-dot" />
              thinking…
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      {/* Composer */}
      <form onSubmit={handleSubmit} className="border-t border-[var(--color-border)] p-3">
        <div
          className="rounded-md border border-[var(--color-border-strong)]
            bg-[var(--color-surface)]
            focus-within:border-[var(--color-text)] transition-colors"
        >
          <div className="flex items-end gap-2 px-2.5 py-1.5">
            <span className="font-mono text-[var(--color-text-dim)] select-none pt-[6px] text-[12px]">
              &gt;
            </span>
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKey}
              placeholder="基于这条调查继续问…"
              rows={1}
              className="flex-1 resize-none bg-transparent text-[13.5px] text-[var(--color-text)]
                placeholder-[var(--color-text-dim)] focus:outline-none py-1 leading-relaxed
                max-h-[160px]"
            />
            <button
              type="submit"
              disabled={loading || !input.trim()}
              className="shrink-0 h-7 min-w-[54px] px-2 grid place-items-center rounded
                bg-[var(--color-accent)] text-[var(--color-bg)]
                hover:bg-[var(--color-accent-hover)]
                disabled:bg-[var(--color-surface-3)] disabled:text-[var(--color-text-dim)]
                disabled:cursor-not-allowed transition-colors
                font-mono text-[10.5px] uppercase tracking-[0.15em]"
              aria-label={loading ? '发送中' : '发送'}
            >
              {loading ? (
                <svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.3" strokeWidth="3" />
                  <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                </svg>
              ) : (
                'send'
              )}
            </button>
          </div>
        </div>
      </form>
    </div>
  )
}
