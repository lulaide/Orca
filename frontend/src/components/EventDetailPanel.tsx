import { useEffect, useMemo, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  getEvent,
  getConversationMessages,
  forkConversation,
  type ChatMessage,
  type EventDetail,
} from '../api'
import { navigate } from '../navigate'
import { ToolCallCard } from './ToolCallCard'
import { InvestigationRefCard } from './InvestigationRefCard'
import { SeverityDot, StatusBadge } from './investigationUI'
import { formatRelativeTime } from '../timeFormat'

interface Props {
  id: string
}

export function EventDetailPanel({ id }: Props) {
  const [detail, setDetail] = useState<EventDetail | null>(null)
  const [messages, setMessages] = useState<ChatMessage[] | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setDetail(null)
    setMessages(null)
    setErr(null)
    getEvent(id)
      .then((d) => {
        if (cancelled) return
        setDetail(d)
        const cid = d.event.conversation_id
        if (cid) {
          getConversationMessages(cid)
            .then((msgs) => { if (!cancelled) setMessages(msgs) })
            .catch(() => { if (!cancelled) setMessages([]) })
        } else {
          setMessages([])
        }
      })
      .catch((e) => { if (!cancelled) setErr(e?.message || '加载失败') })
    return () => { cancelled = true }
  }, [id])

  // tool 输出 map
  const toolOutputs = useMemo(() => {
    const map: Record<string, string> = {}
    if (!messages) return map
    for (const m of messages) {
      if (m.role === 'tool' && m.tool_call_id) {
        map[m.tool_call_id] = m.content
      }
    }
    return map
  }, [messages])

  // 只保留 assistant 消息（过滤 user/system/tool）
  const assistantMessages = useMemo(() => {
    if (!messages) return []
    return messages.filter((m) => m.role === 'assistant')
  }, [messages])

  if (err) {
    return (
      <div className="flex flex-col flex-1 min-h-0 h-full">
        <TopBar id={id} />
        <div className="flex-1 flex items-center justify-center text-[13px] text-[var(--color-danger)] font-mono">{err}</div>
      </div>
    )
  }

  if (!detail) {
    return (
      <div className="flex flex-col flex-1 min-h-0 h-full">
        <TopBar id={id} />
        <div className="flex-1 flex items-center justify-center text-[12.5px] text-[var(--color-text-dim)]">加载中…</div>
      </div>
    )
  }

  const { event, investigations } = detail
  const processed = !!event.processed_at

  return (
    <div className="flex flex-col flex-1 min-h-0 h-full">
      <TopBar id={id} />

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-6 py-8">
          {/* 事件元信息 */}
          <div className="mb-6">
            <div className="flex items-center gap-2 mb-2 text-[12px] text-[var(--color-text-dim)]">
              <span>来源：{event.source}</span>
              <span>·</span>
              <span>{formatRelativeTime(event.created_at)}</span>
              {!processed ? (
                <span className="ml-2 px-2 py-0.5 rounded-full text-[11px] font-medium bg-[var(--color-warn)]/10 text-[var(--color-warn)] border border-[var(--color-warn)]/20">
                  处理中
                </span>
              ) : (
                <span className="ml-2 px-2 py-0.5 rounded-full text-[11px] font-medium bg-[var(--color-ok)]/10 text-[var(--color-ok)] border border-[var(--color-ok)]/20">
                  已处理
                </span>
              )}
            </div>
            <div className="flex items-start gap-2 mb-3">
              <span className="mt-2"><SeverityDot severity={event.severity} /></span>
              <h1 className="font-semibold text-[18px] md:text-[22px] leading-tight text-[var(--color-text)]">
                {event.title}
              </h1>
            </div>

            {/* 处理摘要 */}
            {event.agent_summary && (
              <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]/60 px-4 py-3 mb-4">
                <div className="text-[13px] font-medium text-[var(--color-text-muted)] mb-1.5">处理摘要</div>
                <div className="orca-prose text-[13.5px]">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{event.agent_summary}</ReactMarkdown>
                </div>
              </div>
            )}
          </div>

          {/* 关联调查 */}
          {investigations.length > 0 && (
            <div className="mb-8">
              <div className="text-[15px] font-semibold text-[var(--color-text)] mb-2">关联调查</div>
              <div className="flex flex-col gap-1.5">
                {investigations.map((inv) => (
                  <button key={inv.id} type="button" onClick={() => navigate(`/i/${inv.id}`)}
                    className="group flex items-center gap-2 px-3 py-2 rounded-md border border-[var(--color-border)]
                      hover:border-[var(--color-border-strong)] hover:bg-[var(--color-surface)] text-left transition-colors">
                    <SeverityDot severity={inv.severity} />
                    <span className="flex-1 truncate text-[13.5px] text-[var(--color-text)]">{inv.title || '未命名调查'}</span>
                    <StatusBadge status={inv.status} />
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Agent 处理过程 — 平铺式，不用对话气泡 */}
          <div className="mb-6">
            <div className="text-[15px] font-semibold text-[var(--color-text)] mb-3">处理过程</div>

            {!event.conversation_id && (
              <div className="text-[12.5px] text-[var(--color-text-dim)]">暂无处理记录</div>
            )}

            {event.conversation_id && messages === null && (
              <div className="text-[12.5px] text-[var(--color-text-dim)]">加载中…</div>
            )}

            {event.conversation_id && !processed && assistantMessages.length === 0 && messages !== null && (
              <div className="flex items-center gap-2 text-[13px] text-[var(--color-text-dim)]">
                <span className="w-2 h-2 rounded-full bg-[var(--color-accent)] animate-pulse" />
                Agent 正在处理中…
              </div>
            )}

            {assistantMessages.length > 0 && (
              <div className="space-y-4">
                {assistantMessages.map((m) => (
                  <div key={m.id}>
                    {/* 文字内容 */}
                    {m.content && (
                      <div className="orca-prose text-[13.5px] mb-2">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown>
                      </div>
                    )}
                    {/* 工具调用 */}
                    {m.tool_calls && m.tool_calls.length > 0 && (
                      <div className="space-y-1.5">
                        {m.tool_calls.map((tc) =>
                          tc.function.name === 'create_investigation' ? (
                            <InvestigationRefCard key={tc.id} toolCall={tc} output={toolOutputs[tc.id]} />
                          ) : (
                            <ToolCallCard key={tc.id} toolCall={tc} output={toolOutputs[tc.id]} />
                          ),
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 继续对话按钮 — 仅处理完成后显示 */}
          {processed && event.conversation_id && (
            <div className="flex justify-center pt-4 pb-8">
              <button type="button" onClick={async () => {
                try {
                  const conv = await forkConversation(event.conversation_id!)
                  navigate(`/c/${conv.id}`)
                } catch { /* */ }
              }} className="orca-btn-secondary">
                继续对话 →
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function TopBar({ id }: { id: string }) {
  return (
    <header className="flex items-center px-4 md:px-6 h-12 border-b border-[var(--color-border)] bg-[var(--color-bg)]">
      <button type="button" onClick={() => navigate('/events')}
        className="md:hidden mr-2 text-[var(--color-accent)]">
        <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M15 18l-6-6 6-6" /></svg>
      </button>
      <span className="text-[14px] font-medium text-[var(--color-text)]">事件详情</span>
      <span className="text-[12px] text-[var(--color-text-dim)] ml-2 hidden md:inline">{id.slice(0, 8)}</span>
    </header>
  )
}
