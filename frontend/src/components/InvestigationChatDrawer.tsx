import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import {
  streamChat,
  listConversationInvestigations,
  unlinkInvestigationFromConversation,
  type ChatMessage,
  type Investigation,
  type ReferencedInvestigation,
} from '../api'
import { UserMessage, AssistantTurn } from './MessageBubble'
import { InvestigationReferenceDraftChip } from './InvestigationReferenceCard'
import { SeverityDot, StatusBadge } from './investigationUI'
import { navigate } from '../navigate'

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
  investigation: Investigation
  onClose: () => void
}

/**
 * 详情页右侧的迷你聊天抽屉。
 * 内部维护独立会话（conversationId 初态 null，首条消息后由后端回填）。
 * 初始把当前 investigation 作为引用注入；之后由用户自行管理 draft chip。
 */
export function InvestigationChatDrawer({ investigation, onClose }: Props) {
  const { id: investigationId } = investigation
  const initialRef: ReferencedInvestigation = {
    id: investigation.id,
    title: investigation.title,
    severity: investigation.severity,
    status: investigation.status,
  }

  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [conversationId, setConversationId] = useState<string | null>(null)
  // 本轮草稿引用；挂载时把当前 investigation 填进去，发送后清空（但顶部 chip bar 仍显示）
  const [referencedInvs, setReferencedInvs] = useState<ReferencedInvestigation[]>([initialRef])
  // 对话级引用（发送后由后端回流到关联表，顶部 chip bar 展示）
  const [convInvestigations, setConvInvestigations] = useState<Investigation[]>([])

  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  // investigation 切换时重置所有状态
  useEffect(() => {
    abortRef.current?.abort()
    setMessages([])
    setLoading(false)
    setConversationId(null)
    setReferencedInvs([initialRef])
    setConvInvestigations([])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [investigationId])

  const refreshConvInvs = (cid: string) => {
    listConversationInvestigations(cid)
      .then(setConvInvestigations)
      .catch(() => {})
  }

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
    const refIds = referencedInvs.map((r) => r.id)
    setInput('')
    setReferencedInvs([])
    setLoading(true)
    const ctrl = new AbortController()
    abortRef.current = ctrl
    let createdId: string | null = null

    try {
      await streamChat(text, conversationId, {
        signal: ctrl.signal,
        referencedInvestigationIDs: refIds,
        onEvent: (ev) => {
          if (ev.type === 'message') {
            setMessages((prev) => [...prev, ev.message])
            if (!conversationId && !createdId && ev.message.conversation_id) {
              createdId = ev.message.conversation_id
            }
          } else if (ev.type === 'done') {
            if (createdId) setConversationId(createdId)
            const cid = conversationId ?? createdId
            if (cid) refreshConvInvs(cid)
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

  const handleUnlinkConvInv = async (invId: string) => {
    if (!conversationId) return
    try {
      await unlinkInvestigationFromConversation(conversationId, invId)
      setConvInvestigations((prev) => prev.filter((i) => i.id !== invId))
    } catch (e) {
      console.error(e)
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
        <div className="flex items-center gap-1.5 text-[var(--color-text-muted)]">
          <span className="text-[var(--color-accent)]">✦</span>
          <span className="text-[13px]">对话</span>
          {conversationId && (
            <>
              <span className="text-[var(--color-text-dim)]">·</span>
              <span className="text-[var(--color-text-dim)]">{conversationId.slice(0, 6)}</span>
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

      {/* 顶部 chip bar：本对话已关联的 investigations（发送后才有） */}
      {conversationId && convInvestigations.length > 0 && (
        <div className="border-b border-[var(--color-border)] px-3 py-2 flex items-center gap-1.5 flex-wrap">
          <span className="text-[10.5px] font-medium text-[var(--color-text-dim)] mr-1">
            引用
          </span>
          {convInvestigations.map((inv) => (
            <span
              key={inv.id}
              className="group inline-flex items-center gap-1.5 pl-2 pr-1 py-0.5 rounded-md
                border border-[var(--color-border-strong)] bg-[var(--color-surface)] text-[11.5px] max-w-[240px]"
            >
              <SeverityDot severity={inv.severity} />
              <button
                type="button"
                onClick={() => navigate(`/i/${inv.id}`)}
                className="truncate text-[var(--color-text)] hover:text-[var(--color-accent)]"
                title={inv.title}
              >
                {inv.title || '未命名调查'}
              </button>
              <StatusBadge status={inv.status} />
              <button
                type="button"
                onClick={() => void handleUnlinkConvInv(inv.id)}
                className="ml-1 w-4 h-4 inline-flex items-center justify-center rounded
                  text-[var(--color-text-dim)] hover:text-[var(--color-danger)]
                  hover:bg-[var(--color-surface-2)] opacity-0 group-hover:opacity-100 transition-opacity"
                aria-label="解除关联"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto orca-grid">
        <div className="px-3 py-4">
          {showEmpty && (
            <div className="orca-fade-in text-[12.5px] text-[var(--color-text-dim)] leading-relaxed">
              <p className="mb-1 text-[var(--color-text-muted)]">基于当前调查问点什么？</p>
              <p>
                发送时会自动带上这条调查作为引用；之后的消息在同一会话里继续追问。
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
          {referencedInvs.length > 0 && (
            <div className="flex flex-wrap gap-1.5 px-2.5 py-1.5 border-b border-[var(--color-border)]">
              {referencedInvs.map((r) => (
                <InvestigationReferenceDraftChip
                  key={r.id}
                  inv={r}
                  onRemove={() => setReferencedInvs((prev) => prev.filter((x) => x.id !== r.id))}
                />
              ))}
            </div>
          )}
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
                text-[10.5px]"
              aria-label={loading ? '发送中' : '发送'}
            >
              {loading ? (
                <svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.3" strokeWidth="3" />
                  <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                </svg>
              ) : (
                '发送'
              )}
            </button>
          </div>
        </div>
      </form>
    </div>
  )
}
