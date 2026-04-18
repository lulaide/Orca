import { useEffect, useMemo, useState } from 'react'
import {
  getEvent,
  getConversationMessages,
  type ChatMessage,
  type EventDetail,
} from '../api'
import { navigate } from '../navigate'
import { UserMessage, AssistantTurn } from './MessageBubble'
import { SeverityDot, StatusBadge } from './investigationUI'
import { formatRelativeTime } from '../timeFormat'

// EventDetailPanel 展示一次 Event 的完整处理轨迹：
//   1. 顶部：Event 元信息 + pending/done 徽标 + agent_summary
//   2. 中段：Agent 在这次事件里创建 / 关联的 Investigation chip
//   3. 主体：复用 ChatPanel 的消息渲染，把 Agent Loop 里的
//      user / assistant / tool 调用按轮次展开。这样用户看到的
//      是和用户会话一致的时间线——工具参数、工具结果、思考都在。
//
// 数据来源：/api/events/:id 拿 Event + 关联 Investigation，
// /api/conversations/:cid/messages 拿完整消息（由 EventRouter 在
// runAgent 里创建的那条 Conversation）。

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
    // tool / system: tool 由 ToolCallCard 通过 tool_call_id 取用，system 不展示
  }
  return turns
}

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
            .then((msgs) => {
              if (!cancelled) setMessages(msgs)
            })
            .catch(() => {
              if (!cancelled) setMessages([])
            })
        } else {
          setMessages([])
        }
      })
      .catch((e) => {
        if (!cancelled) setErr(e?.message || '加载失败')
      })
    return () => {
      cancelled = true
    }
  }, [id])

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

  const turns = useMemo(() => (messages ? groupIntoTurns(messages) : []), [messages])

  if (err) {
    return (
      <div className="flex flex-col flex-1 min-h-0 h-full">
        <TopBar id={id} />
        <div className="flex-1 flex items-center justify-center text-[13px] text-[var(--color-danger)] font-mono">
          {err}
        </div>
      </div>
    )
  }

  if (!detail) {
    return (
      <div className="flex flex-col flex-1 min-h-0 h-full">
        <TopBar id={id} />
        <div className="flex-1 flex items-center justify-center text-[12.5px] text-[var(--color-text-dim)] italic">
          加载中…
        </div>
      </div>
    )
  }

  const { event, investigations } = detail
  const processed = !!event.processed_at

  return (
    <div className="flex flex-col flex-1 min-h-0 h-full">
      <TopBar id={id} />

      <div className="flex-1 overflow-y-auto orca-grid">
        <div className="max-w-3xl mx-auto px-6 py-8">
          {/* Event 元信息 */}
          <div className="mb-6">
            <div className="flex items-center gap-2 mb-2 text-[11px] font-mono uppercase tracking-[0.18em] text-[var(--color-text-dim)]">
              <span>event</span>
              <span>·</span>
              <span>{event.source}</span>
              <span>·</span>
              <span className="tabular-nums">{formatRelativeTime(event.created_at)}</span>
              {!processed ? (
                <span className="ml-2 px-1.5 py-0.5 border rounded text-[var(--color-warn)] border-[var(--color-warn)]/40">
                  pending
                </span>
              ) : (
                <span className="ml-2 px-1.5 py-0.5 border rounded text-[var(--color-ok)] border-[var(--color-ok)]/40">
                  done
                </span>
              )}
            </div>
            <div className="flex items-start gap-2 mb-3">
              <span className="mt-2">
                <SeverityDot severity={event.severity} />
              </span>
              <h1 className="font-serif-display text-[28px] leading-tight text-[var(--color-text)]">
                {event.title}
              </h1>
            </div>
            {event.related_services && event.related_services.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-3">
                {event.related_services.map((s) => (
                  <span
                    key={s}
                    className="px-2 py-0.5 rounded border border-[var(--color-border)]
                      text-[11.5px] font-mono text-[var(--color-text-muted)]"
                  >
                    {s}
                  </span>
                ))}
              </div>
            )}
            {event.agent_summary && (
              <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)]/60 px-4 py-3">
                <div className="text-[10.5px] font-mono uppercase tracking-[0.2em] text-[var(--color-text-dim)] mb-1">
                  agent summary
                </div>
                <div className="text-[13.5px] text-[var(--color-text)] leading-relaxed whitespace-pre-wrap">
                  {event.agent_summary}
                </div>
              </div>
            )}
          </div>

          {/* 关联 Investigation chip 条 */}
          <div className="mb-8">
            <div className="text-[10.5px] font-mono uppercase tracking-[0.2em] text-[var(--color-text-dim)] mb-2">
              linked investigations · 本次事件产生的调查
            </div>
            {investigations.length === 0 ? (
              <div className="text-[12.5px] text-[var(--color-text-dim)] italic">
                无——Agent 判定为瞬时抖动或未产生调查。
              </div>
            ) : (
              <div className="flex flex-col gap-1.5">
                {investigations.map((inv) => (
                  <button
                    key={inv.id}
                    type="button"
                    onClick={() => navigate(`/i/${inv.id}`)}
                    className="group flex items-center gap-2 px-3 py-2 rounded-md
                      border border-[var(--color-border)]
                      hover:border-[var(--color-border-strong)] hover:bg-[var(--color-surface)]
                      text-left transition-colors"
                  >
                    <SeverityDot severity={inv.severity} />
                    <span className="flex-1 truncate text-[13.5px] text-[var(--color-text)]">
                      {inv.title || '未命名调查'}
                    </span>
                    <StatusBadge status={inv.status} />
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Agent 处理时间线 —— 复用 ChatPanel 的轮次渲染 */}
          <div>
            <div className="text-[10.5px] font-mono uppercase tracking-[0.2em] text-[var(--color-text-dim)] mb-3">
              agent timeline · 处理过程
            </div>
            {!event.conversation_id && (
              <div className="text-[12.5px] text-[var(--color-text-dim)] italic">
                本事件没有关联的 Agent 会话记录（可能是旧数据，或 Agent Loop 尚未写入会话）。
              </div>
            )}
            {event.conversation_id && messages === null && (
              <div className="text-[12.5px] text-[var(--color-text-dim)] italic">加载消息中…</div>
            )}
            {event.conversation_id && messages && messages.length === 0 && (
              <div className="text-[12.5px] text-[var(--color-text-dim)] italic">
                会话暂无消息。
              </div>
            )}
            {event.conversation_id && messages && messages.length > 0 && (
              <div>
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
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function TopBar({ id }: { id: string }) {
  return (
    <header className="flex items-center justify-between px-6 h-11 border-b border-[var(--color-border)] bg-[var(--color-bg)] font-mono text-[11px]">
      <div className="flex items-center gap-2 text-[var(--color-text-dim)]">
        <span className="text-[var(--color-accent)]">~</span>
        <span>/</span>
        <span>orca</span>
        <span>/</span>
        <button
          type="button"
          onClick={() => navigate('/events')}
          className="hover:text-[var(--color-text)] transition-colors"
        >
          events
        </button>
        <span>/</span>
        <span className="text-[var(--color-text-muted)]">{id.slice(0, 8)}</span>
      </div>
    </header>
  )
}
