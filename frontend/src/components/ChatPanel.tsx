import { useState, useRef, useEffect, useMemo, type FormEvent, type KeyboardEvent } from 'react'
import {
  streamChat,
  getConversationMessages,
  listConversationInvestigations,
  unlinkInvestigationFromConversation,
  type ChatMessage,
  type Investigation,
  type ReferencedInvestigation,
} from '../api'
import { UserMessage, AssistantTurn } from './MessageBubble'
import { InvestigationPicker } from './InvestigationPicker'
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
    // tool / system: tool 通过 toolOutputs 绑到 ToolCallCard，system 不展示
  }
  return turns
}

function toRefSummary(inv: Investigation): ReferencedInvestigation {
  return { id: inv.id, title: inv.title, severity: inv.severity, status: inv.status }
}

interface Props {
  conversationId: string | null
  onConversationCreated: (id: string) => void
  onConversationUpdated: () => void
  /** 由 HomePanel 提交的首条消息。非空时挂载后自动发送一次。 */
  initialMessage?: string | null
  /** 与 initialMessage 配对的初始引用列表。 */
  initialReferencedInvestigations?: ReferencedInvestigation[]
  /** 自动发送后通知父组件清空 pendingInitialMessage。 */
  onInitialMessageConsumed?: () => void
}

const SUGGESTIONS = [
  {
    tag: '巡检',
    title: '集群健康检查',
    sub: '扫一遍 Pod 与最近事件，挑出异常',
    prompt: '帮我做一次快速的集群健康检查，挑出任何异常情况。',
  },
  {
    tag: '概览',
    title: 'kube-system 命名空间',
    sub: '列出所有 Pod 及其状态',
    prompt: '列出 kube-system 命名空间里的所有 Pod 及其状态。',
  },
  {
    tag: '排障',
    title: '排查 CrashLoopBackOff',
    sub: '找出崩溃 Pod 并深入追根因',
    prompt: '跨所有命名空间查一下有没有 CrashLoopBackOff 的 Pod，挑最严重的那个深入排查。',
  },
  {
    tag: '节点',
    title: '节点压力与容量',
    sub: '检查 node 状态、污点、资源水位',
    prompt: '检查节点状态——有没有 pressure 条件、污点、或者容量问题？',
  },
]

export function ChatPanel({
  conversationId,
  onConversationCreated,
  onConversationUpdated,
  initialMessage,
  initialReferencedInvestigations,
  onInitialMessageConsumed,
}: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [quoteSel, setQuoteSel] = useState<{ text: string; top: number; left: number } | null>(null)
  const [quoteDraft, setQuoteDraft] = useState<string | null>(null)
  // 本轮发送前已选中的引用
  const [referencedInvs, setReferencedInvs] = useState<ReferencedInvestigation[]>([])
  // 本对话已关联的 investigations（顶部 chip bar）
  const [convInvestigations, setConvInvestigations] = useState<Investigation[]>([])
  // picker 状态
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerQuery, setPickerQuery] = useState('')
  const [pickerAnchor, setPickerAnchor] = useState<{ x: number; y: number } | undefined>(undefined)
  // @ 触发时记录在 textarea 里的起始位置,用于 pick 后删掉 @token
  const atTokenRef = useRef<{ start: number; end: number } | null>(null)

  const bottomRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  // 确保 initialMessage 只触发一次 send，防止 React Strict Mode 或父组件 re-render 导致重入
  const initialSentRef = useRef(false)

  useEffect(() => {
    abortRef.current?.abort()
    setLoading(false)
    setReferencedInvs([])
    if (!conversationId) {
      setMessages([])
      setConvInvestigations([])
      return
    }
    let cancelled = false
    getConversationMessages(conversationId)
      .then((msgs) => {
        if (!cancelled) setMessages(msgs)
      })
      .catch((err) => {
        console.error(err)
        if (!cancelled) setMessages([])
      })
    return () => {
      cancelled = true
    }
  }, [conversationId])

  // 拉取本对话已关联的 investigations
  const refreshConvInvs = (id: string) => {
    listConversationInvestigations(id)
      .then((list) => setConvInvestigations(list))
      .catch(() => {})
  }
  useEffect(() => {
    if (!conversationId) return
    refreshConvInvs(conversationId)
  }, [conversationId])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  useEffect(() => {
    const ta = textareaRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = Math.min(ta.scrollHeight, 220) + 'px'
  }, [input])

  const toolOutputs = useMemo(() => {
    const map: Record<string, string> = {}
    for (const m of messages) {
      if (m.role === 'tool' && m.tool_call_id) {
        map[m.tool_call_id] = m.content
      }
    }
    return map
  }, [messages])

  const turns = useMemo(() => groupIntoTurns(messages), [messages])

  const send = async (text: string, refOverride?: ReferencedInvestigation[]) => {
    if (!text || loading) return
    const quoted = quoteDraft
      ? quoteDraft.split(/\r?\n/).map((l) => `> ${l}`).join('\n') + '\n\n'
      : ''
    const finalText = quoted + text
    const refs = refOverride ?? referencedInvs
    const refIds = refs.map((r) => r.id)
    setInput('')
    setQuoteDraft(null)
    setReferencedInvs([])
    setLoading(true)
    const ctrl = new AbortController()
    abortRef.current = ctrl

    let createdId: string | null = null

    try {
      await streamChat(finalText, conversationId, {
        signal: ctrl.signal,
        referencedInvestigationIDs: refIds,
        onEvent: (ev) => {
          if (ev.type === 'message') {
            setMessages((prev) => [...prev, ev.message])
            if (!conversationId && !createdId && ev.message.conversation_id) {
              createdId = ev.message.conversation_id
            }
          } else if (ev.type === 'done') {
            if (createdId) onConversationCreated(createdId)
            onConversationUpdated()
            // 刷新顶部 chip bar（Agent 可能调了 create_investigation）
            const cid = conversationId ?? createdId
            if (cid) refreshConvInvs(cid)
            // 后端会异步用 LLM 生成更好的标题,给它几秒时间后再刷一次侧边栏
            setTimeout(() => onConversationUpdated(), 3500)
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

  // Home 输入框传入的首条消息：挂载后自动发送一次
  useEffect(() => {
    if (!initialMessage) return
    if (initialSentRef.current) return
    if (conversationId) return
    initialSentRef.current = true
    const refs = initialReferencedInvestigations ?? []
    // 让 UI 能在发送瞬间显示 chip（虽然 send 会立即清空，但 loading 期间 UserMessage 会接手渲染）
    if (refs.length > 0) setReferencedInvs(refs)
    onInitialMessageConsumed?.()
    void send(initialMessage, refs)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialMessage])

  // ---- 选中文本 → 浮出 Reply 按钮 → 以 blockquote 形式插入输入框 ----
  const handleSelectionMouseUp = () => {
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
      setQuoteSel(null)
      return
    }
    const text = sel.toString()
    if (!text.trim()) {
      setQuoteSel(null)
      return
    }
    const range = sel.getRangeAt(0)
    const node = range.commonAncestorContainer
    const el = node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as Element)
    if (!el || !el.closest('[data-assistant-content]')) {
      setQuoteSel(null)
      return
    }
    const rect = range.getBoundingClientRect()
    const left = Math.min(rect.right + 8, window.innerWidth - 96)
    const top = rect.top - 6
    setQuoteSel({ text: text.trim(), top, left })
  }

  useEffect(() => {
    if (!quoteSel) return
    const dismiss = () => setQuoteSel(null)
    window.addEventListener('scroll', dismiss, true)
    return () => window.removeEventListener('scroll', dismiss, true)
  }, [quoteSel])

  const quoteIntoInput = () => {
    if (!quoteSel) return
    setQuoteDraft(quoteSel.text)
    setQuoteSel(null)
    window.getSelection()?.removeAllRanges()
    setTimeout(() => textareaRef.current?.focus(), 0)
  }

  // ---- @ 触发 picker ----
  // 扫描 cursor 前最近的未结束 @token（@ 到空白/行首之间无空白），命中则开启 picker
  const detectAtToken = () => {
    const ta = textareaRef.current
    if (!ta) return
    const pos = ta.selectionStart ?? 0
    const before = ta.value.slice(0, pos)
    // 找最后一个 @ 并确保到 pos 之间没空白
    const atIdx = before.lastIndexOf('@')
    if (atIdx < 0) {
      if (pickerAnchor) setPickerOpen(false)
      return
    }
    const token = before.slice(atIdx + 1)
    if (/\s/.test(token)) {
      if (pickerAnchor) setPickerOpen(false)
      return
    }
    // 命中：记录 token 范围，用 caret 位置做 anchor
    atTokenRef.current = { start: atIdx, end: pos }
    setPickerQuery(token)
    // caret 屏幕坐标用 textarea 自身 rect + 粗略行高近似
    const rect = ta.getBoundingClientRect()
    setPickerAnchor({ x: Math.max(8, rect.left + 12), y: rect.top - 8 })
    setPickerOpen(true)
  }

  const handleInput = () => {
    detectAtToken()
  }

  // attach 按钮触发：不在 textarea 里，也没有 @token
  const toggleAttachPicker = () => {
    atTokenRef.current = null
    setPickerAnchor(undefined)
    setPickerQuery('')
    setPickerOpen((v) => !v)
  }

  const handlePick = (inv: Investigation) => {
    const ref = toRefSummary(inv)
    setReferencedInvs((prev) => (prev.some((r) => r.id === ref.id) ? prev : [...prev, ref]))
    // @ 触发的要从 textarea 里删掉 @token
    const tok = atTokenRef.current
    if (tok) {
      const ta = textareaRef.current
      const v = ta?.value ?? input
      const next = v.slice(0, tok.start) + v.slice(tok.end)
      setInput(next)
      // 恢复光标到 @ 处
      setTimeout(() => {
        if (ta) {
          ta.focus()
          ta.selectionStart = ta.selectionEnd = tok.start
        }
      }, 0)
    }
    atTokenRef.current = null
    setPickerOpen(false)
    setPickerQuery('')
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

  // 有待自动发送的首条消息时不渲染 EmptyState，避免挂载瞬间闪出引导卡片
  const hasPendingInitial = !!initialMessage && !initialSentRef.current
  const showEmpty = messages.length === 0 && !loading && !hasPendingInitial
  const msgCount = messages.filter((m) => m.role !== 'system').length

  return (
    <div className="flex flex-col flex-1 min-h-0 h-full relative">
      {quoteSel && (
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={quoteIntoInput}
          className="fixed z-50 flex items-center gap-1.5 px-2.5 py-1.5 rounded-md
            bg-[var(--color-text)] text-[var(--color-bg)]
            shadow-lg text-[11px] font-mono
            hover:opacity-90 transition-opacity orca-fade-in"
          style={{ top: quoteSel.top, left: quoteSel.left, transform: 'translateY(-100%)' }}
        >
          追问
          <span className="text-[11.5px] opacity-70">↵</span>
        </button>
      )}
      {/* Header */}
      <header className="flex items-center justify-between px-6 h-12 border-b border-[var(--color-border)] bg-[var(--color-bg)]">
        <span className="text-[14px] font-medium text-[var(--color-text)]">
          {conversationId ? '对话' : '新对话'}
        </span>
        {msgCount > 0 && (
          <span className="text-[12px] text-[var(--color-text-dim)]">
            {msgCount} 条消息
          </span>
        )}
      </header>

      {/* 顶部 chip bar：本对话已关联的 investigations */}
      {conversationId && convInvestigations.length > 0 && (
        <div className="border-b border-[var(--color-border)] bg-[var(--color-bg)] px-6 py-2">
          <div className="max-w-3xl mx-auto flex items-center gap-2 flex-wrap">
            <span className="text-[12px] text-[var(--color-text-dim)] mr-1">
              引用
            </span>
            {convInvestigations.map((inv) => (
              <ConvInvChip
                key={inv.id}
                inv={inv}
                onOpen={() => navigate(`/i/${inv.id}`)}
                onRemove={() => void handleUnlinkConvInv(inv.id)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Messages — dot-grid 背景 */}
      <div className="flex-1 overflow-y-auto orca-grid" onMouseUp={handleSelectionMouseUp}>
        <div className="max-w-3xl mx-auto px-6 py-10">
          {showEmpty && <EmptyState onPick={(p) => void send(p)} />}
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
          {loading && turns[turns.length - 1]?.kind === 'user' && <ThinkingIndicator />}
          <div ref={bottomRef} />
        </div>
      </div>

      {/* Composer */}
      <div className="border-t border-[var(--color-border)] bg-[var(--color-bg)]">
        <form onSubmit={handleSubmit} className="max-w-3xl mx-auto px-6 py-4">
          {/* picker as attach-dropdown 模式：挂在 composer 外层容器，相对定位 */}
          <div className="relative">
            {pickerOpen && !pickerAnchor && (
              <InvestigationPicker
                open={pickerOpen}
                searchQuery={pickerQuery}
                onSearchQueryChange={setPickerQuery}
                excludeIds={referencedInvs.map((r) => r.id)}
                onPick={handlePick}
                onClose={() => setPickerOpen(false)}
              />
            )}
            <div
              className="rounded-lg border border-[var(--color-border-strong)]
                bg-[var(--color-surface)]
                focus-within:border-[var(--color-text)]
                transition-colors"
            >
              {/* 草稿引用 chips */}
              {referencedInvs.length > 0 && (
                <div className="flex flex-wrap gap-1.5 px-3 py-2 border-b border-[var(--color-border)]">
                  {referencedInvs.map((r) => (
                    <InvestigationReferenceDraftChip
                      key={r.id}
                      inv={r}
                      onRemove={() =>
                        setReferencedInvs((prev) => prev.filter((x) => x.id !== r.id))
                      }
                    />
                  ))}
                </div>
              )}
              {quoteDraft && (
                <div
                  className="flex items-start gap-2 px-3 py-2 border-b border-[var(--color-border)]
                    orca-fade-in"
                >
                  <span className="shrink-0 text-[var(--color-text-dim)] font-mono text-[12px] pt-[2px]">
                    ↳
                  </span>
                  <div className="flex-1 min-w-0 text-[12.5px] text-[var(--color-text-muted)] leading-snug whitespace-pre-wrap break-words max-h-16 overflow-hidden line-clamp-2">
                    {quoteDraft}
                  </div>
                  <button
                    type="button"
                    onClick={() => setQuoteDraft(null)}
                    className="shrink-0 w-5 h-5 grid place-items-center rounded
                      text-[var(--color-text-dim)] hover:text-[var(--color-text)]
                      hover:bg-[var(--color-surface-2)] transition-colors"
                    aria-label="清除引用"
                  >
                    <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      <path d="M6 6l12 12M18 6L6 18" />
                    </svg>
                  </button>
                </div>
              )}
              <div className="flex items-end gap-2 px-3 py-2">
                <button
                  type="button"
                  onClick={toggleAttachPicker}
                  className="shrink-0 w-8 h-8 grid place-items-center rounded
                    text-[var(--color-text-dim)] hover:text-[var(--color-text)]
                    hover:bg-[var(--color-surface-2)] transition-colors"
                  aria-label="引用调查"
                  title="引用调查"
                >
                  <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                  </svg>
                </button>
                <span className="font-mono text-[var(--color-text-dim)] select-none self-center">
                  &gt;
                </span>
                <textarea
                  ref={textareaRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onInput={handleInput}
                  onKeyDown={handleKey}
                  placeholder="问问集群的情况…（Enter 发送 · Shift+Enter 换行 · @ 引用调查）"
                  rows={1}
                  className="flex-1 resize-none bg-transparent text-[0.9375rem] text-[var(--color-text)]
                    placeholder-[var(--color-text-dim)] focus:outline-none py-1.5
                    leading-relaxed max-h-[220px]"
                />
                <button
                  type="submit"
                  disabled={loading || !input.trim()}
                  className="shrink-0 h-8 min-w-[64px] px-3 grid place-items-center rounded
                    bg-[var(--color-accent)] text-[var(--color-bg)]
                    hover:bg-[var(--color-accent-hover)]
                    disabled:bg-[var(--color-surface-3)] disabled:text-[var(--color-text-dim)]
                    disabled:cursor-not-allowed transition-colors
                    text-[13px]"
                  aria-label={loading ? '发送中' : '发送'}
                >
                  {loading ? (
                    <svg
                      className="w-3.5 h-3.5 animate-spin"
                      viewBox="0 0 24 24"
                      fill="none"
                    >
                      <circle
                        cx="12"
                        cy="12"
                        r="9"
                        stroke="currentColor"
                        strokeOpacity="0.3"
                        strokeWidth="3"
                      />
                      <path
                        d="M21 12a9 9 0 0 0-9-9"
                        stroke="currentColor"
                        strokeWidth="3"
                        strokeLinecap="round"
                      />
                    </svg>
                  ) : (
                    '发送'
                  )}
                </button>
              </div>
            </div>
          </div>
          <div className="mt-2 px-1 text-[12px] text-[var(--color-text-dim)]">
            Orca 会调用只读工具进行排查·所有操作可在时间线中审计
          </div>
        </form>
      </div>

      {/* @ 触发的 picker 用 fixed anchor 模式，独立渲染在根节点下 */}
      {pickerOpen && pickerAnchor && (
        <InvestigationPicker
          open={pickerOpen}
          anchor={pickerAnchor}
          searchQuery={pickerQuery}
          onSearchQueryChange={setPickerQuery}
          excludeIds={referencedInvs.map((r) => r.id)}
          onPick={handlePick}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  )
}

function ConvInvChip({
  inv,
  onOpen,
  onRemove,
}: {
  inv: Investigation
  onOpen: () => void
  onRemove: () => void
}) {
  return (
    <span className="group inline-flex items-center gap-1.5 pl-2 pr-1 py-0.5 rounded-md
      border border-[var(--color-border-strong)] bg-[var(--color-surface)]
      text-[12px] max-w-[320px]">
      <SeverityDot severity={inv.severity} />
      <button
        type="button"
        onClick={onOpen}
        className="truncate text-[var(--color-text)] hover:text-[var(--color-accent)] transition-colors"
        title={inv.title}
      >
        {inv.title || '未命名调查'}
      </button>
      <StatusBadge status={inv.status} />
      <button
        type="button"
        onClick={onRemove}
        className="ml-1 w-4 h-4 inline-flex items-center justify-center rounded
          text-[var(--color-text-dim)] hover:text-[var(--color-danger)]
          hover:bg-[var(--color-surface-2)] opacity-0 group-hover:opacity-100 transition-opacity"
        aria-label="解除关联"
        title="解除关联"
      >
        ×
      </button>
    </span>
  )
}

function EmptyState({ onPick }: { onPick: (prompt: string) => void }) {
  return (
    <div className="py-10 orca-fade-in">
      <div className="mb-8">
        <div className="text-[13px] text-[var(--color-text-dim)] mb-3">
          就绪
        </div>
        <h1 className="font-semibold text-[44px] leading-[1.05] text-[var(--color-text)] mb-3">
          查点什么？
        </h1>
        <p className="text-[14px] text-[var(--color-text-muted)] max-w-md leading-relaxed">
          Orca 会调用只读工具实时排查你的 Kubernetes 集群，挑一张卡片开始，或者自己输入问题。
        </p>
      </div>

      <div className="space-y-px border-t border-[var(--color-border)]">
        {SUGGESTIONS.map((s) => (
          <button
            key={s.title}
            type="button"
            onClick={() => onPick(s.prompt)}
            className="group w-full text-left py-3 px-1 flex items-center gap-4
              border-b border-[var(--color-border)]
              hover:bg-[var(--color-surface)]
              transition-colors"
          >
            <span className="shrink-0 w-14 text-[13px] font-medium text-[var(--color-accent)]">
              {s.tag}
            </span>
            <span className="flex-1 min-w-0">
              <span className="block text-[15px] font-medium text-[var(--color-text)] mb-0.5">
                {s.title}
              </span>
              <span className="block text-[12.5px] text-[var(--color-text-dim)]">{s.sub}</span>
            </span>
            <span className="shrink-0 text-[var(--color-text-dim)] opacity-0 group-hover:opacity-100 transition-opacity text-[14px]">
              →
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}

function ThinkingIndicator() {
  return (
    <div className="pl-4 border-l-2 border-[var(--color-accent)]/60 orca-fade-in mb-7">
      <div className="flex items-center gap-2 mb-2 -ml-[22px]">
        <span className="w-4 h-4 rounded-full bg-[var(--color-bg)] border-2 border-[var(--color-accent)] orca-pulse-dot" />
        <span className="font-semibold text-[15px] text-[var(--color-text-muted)]">orca</span>
      </div>
      <div className="flex items-center gap-1.5 py-1">
        <span className="w-1 h-1 rounded-full bg-[var(--color-text-dim)] orca-pulse-dot" style={{ animationDelay: '0ms' }} />
        <span className="w-1 h-1 rounded-full bg-[var(--color-text-dim)] orca-pulse-dot" style={{ animationDelay: '180ms' }} />
        <span className="w-1 h-1 rounded-full bg-[var(--color-text-dim)] orca-pulse-dot" style={{ animationDelay: '360ms' }} />
        <span className="ml-2 text-[12px] text-[var(--color-text-dim)]">思考中</span>
      </div>
    </div>
  )
}
