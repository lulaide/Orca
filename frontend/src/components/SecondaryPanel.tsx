import { useEffect, useState } from 'react'
import {
  listConversations,
  deleteConversation,
  listEvents,
  listInvestigations,
  listSkills,
  type Conversation,
  type OrcaEvent,
  type Investigation,
  type Skill,
  type InvestigationView,
} from '../api'
import { navigate } from '../navigate'
import { SeverityDot, StatusBadge } from './investigationUI'
import type { Module } from './IconRail'

interface Props {
  module: Module
  refreshToken: number
  // Chat
  activeConversationId: string | null
  onSelectConversation: (id: string | null) => void
  // Events
  activeEventId: string | null
  // Investigations
  activeInvestigationId: string | null
  investigationView: InvestigationView
  // Knowledge
  activeKnowledgeSlug: string | null
  onSelectKnowledgeSlug: (slug: string) => void
}

export function SecondaryPanel(props: Props) {
  return (
    <aside className="w-full md:w-64 shrink-0 flex flex-col h-full border-r border-[var(--color-border)] bg-[var(--color-surface)] pb-14 md:pb-0 overflow-hidden">
      {props.module === 'chat' && <ChatList {...props} />}
      {props.module === 'events' && <EventsList {...props} />}
      {props.module === 'investigations' && <InvestigationsList {...props} />}
      {props.module === 'knowledge' && <SkillList {...props} />}
    </aside>
  )
}

// ======================== Chat 会话列表 ========================

function ChatList({ refreshToken, activeConversationId, onSelectConversation }: Props) {
  const [convs, setConvs] = useState<Conversation[]>([])
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<Conversation | null>(null)

  useEffect(() => {
    listConversations().then(setConvs).catch(console.error)
  }, [refreshToken])

  const confirmDelete = async () => {
    if (!pendingDelete) return
    const id = pendingDelete.id
    setPendingDelete(null)
    try {
      await deleteConversation(id)
      setConvs((prev) => prev.filter((c) => c.id !== id))
      if (activeConversationId === id) onSelectConversation(null)
    } catch (err) {
      console.error(err)
    }
  }

  return (
    <>
      {pendingDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setPendingDelete(null)}>
          <div className="bg-[var(--color-bg)] border border-[var(--color-border)] rounded-lg p-5 max-w-sm mx-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}>
            <h3 className="text-[15px] font-semibold text-[var(--color-text)] mb-2">删除此对话？</h3>
            <p className="text-[13px] text-[var(--color-text-muted)] mb-1">
              {pendingDelete.title || '未命名'}
            </p>
            <p className="text-[12px] text-[var(--color-text-dim)] mb-4">
              会永久移除对话记录与全部消息，无法恢复。
            </p>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setPendingDelete(null)}
                className="h-8 px-3 rounded border border-[var(--color-border-strong)]
                  text-[13px] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-2)] transition-colors">
                取消
              </button>
              <button type="button" onClick={confirmDelete}
                className="h-8 px-3 rounded bg-[var(--color-danger)] text-white
                  text-[13px] hover:opacity-90 transition-opacity">
                删除
              </button>
            </div>
          </div>
        </div>
      )}
      <PanelHeader title="对话" action={{ label: '+ 新对话', onClick: () => onSelectConversation(null) }} />
      <div className="flex-1 overflow-y-auto px-2 py-1">
        {convs.length === 0 && <EmptyHint>还没有对话</EmptyHint>}
        {convs.map((c) => {
          const active = c.id === activeConversationId
          return (
            <div
              key={c.id}
              onMouseEnter={() => setHoveredId(c.id)}
              onMouseLeave={() => setHoveredId(null)}
              onClick={() => onSelectConversation(c.id)}
              className={`group relative flex items-center gap-2 pl-3 pr-2 min-w-0 py-[7px] rounded-md cursor-pointer
                text-[13px] transition-colors
                ${active
                  ? 'bg-[var(--color-surface-2)] text-[var(--color-text)]'
                  : 'text-[var(--color-text-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]'}`}
            >
              {active && <ActiveBar />}
              <span className="flex-1 truncate">
                {c.title || <span className="italic text-[var(--color-text-dim)]">未命名</span>}
              </span>
              {hoveredId === c.id ? (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setPendingDelete(c) }}
                  className="shrink-0 w-5 h-5 grid place-items-center rounded
                    text-[var(--color-text-dim)] hover:text-[var(--color-danger)] hover:bg-[var(--color-surface-3)] transition-colors"
                >
                  <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6" strokeLinecap="round" /></svg>
                </button>
              ) : (
                <span className="shrink-0 text-[11px] text-[var(--color-text-dim)] font-mono tabular-nums">
                  {formatShort(c.updated_at)}
                </span>
              )}
            </div>
          )
        })}
      </div>
    </>
  )
}

// ======================== Events 事件列表 ========================

function EventsList({ refreshToken, activeEventId }: Props) {
  const [events, setEvents] = useState<OrcaEvent[]>([])

  useEffect(() => {
    listEvents({ limit: 50 }).then(setEvents).catch(console.error)
  }, [refreshToken])

  return (
    <>
      <PanelHeader title="事件" />
      <div className="flex-1 overflow-y-auto px-2 py-1">
        {events.length === 0 && <EmptyHint>暂无事件</EmptyHint>}
        {events.map((ev) => {
          const active = ev.id === activeEventId
          const processed = !!ev.processed_at
          return (
            <button
              key={ev.id}
              type="button"
              onClick={() => navigate(`/events/${ev.id}`)}
              className={`w-full text-left relative flex items-center gap-2 pl-3 pr-2 min-w-0 py-[7px] rounded-md
                text-[12.5px] transition-colors
                ${active
                  ? 'bg-[var(--color-surface-2)] text-[var(--color-text)]'
                  : 'text-[var(--color-text-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]'}`}
            >
              {active && <ActiveBar />}
              <SeverityDot severity={ev.severity} />
              <span className="flex-1 truncate">{ev.title}</span>
              <span className="shrink-0 text-[11px] text-[var(--color-text-dim)]">
                {formatShort(ev.created_at)}
              </span>
              {!processed && (
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-warn)] shrink-0" />
              )}
            </button>
          )
        })}
      </div>
    </>
  )
}

// ======================== Investigations 调查列表 ========================

function InvestigationsList({ refreshToken, activeInvestigationId, investigationView }: Props) {
  const [invs, setInvs] = useState<Investigation[]>([])

  useEffect(() => {
    listInvestigations({ view: investigationView })
      .then(setInvs).catch(console.error)
  }, [refreshToken, investigationView])

  return (
    <>
      <PanelHeader title="调查" />
      <div className="flex items-center gap-1 px-3 py-1.5 border-b border-[var(--color-border)]">
        {(['active', 'resolved', 'all'] as const).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => navigate(`/i?view=${v}`)}
            className={`text-[13px] font-medium px-2.5 py-1 rounded-lg transition-colors
              ${investigationView === v
                ? 'text-[var(--color-text)] bg-[var(--color-surface-2)]'
                : 'text-[var(--color-text-dim)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-2)]'}`}
          >
            {v === 'active' ? '进行中' : v === 'resolved' ? '已解决' : '全部'}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto px-2 py-1">
        {invs.length === 0 && <EmptyHint>暂无调查</EmptyHint>}
        {invs.map((inv) => {
          const active = inv.id === activeInvestigationId
          return (
            <button
              key={inv.id}
              type="button"
              onClick={() => navigate(`/i/${inv.id}`)}
              className={`w-full text-left relative flex items-center gap-2 pl-3 pr-2 min-w-0 py-[7px] rounded-md
                text-[12.5px] transition-colors
                ${active
                  ? 'bg-[var(--color-surface-2)] text-[var(--color-text)]'
                  : 'text-[var(--color-text-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]'}`}
            >
              {active && <ActiveBar />}
              <SeverityDot severity={inv.severity} />
              <span className="flex-1 truncate">{inv.title}</span>
              <StatusBadge status={inv.status} />
            </button>
          )
        })}
      </div>
    </>
  )
}

// ======================== Skill 技能列表 ========================

function SkillList({ refreshToken, activeKnowledgeSlug, onSelectKnowledgeSlug }: Props) {
  const [skills, setSkills] = useState<Skill[]>([])

  useEffect(() => {
    listSkills().then(setSkills).catch(console.error)
  }, [refreshToken])

  return (
    <>
      <PanelHeader title="技能库" />
      <div className="flex-1 overflow-y-auto px-2 py-1">
        {skills.length === 0 && <EmptyHint>尚未生成</EmptyHint>}
        {skills.map((s) => (
          <button
            key={s.name}
            type="button"
            onClick={() => onSelectKnowledgeSlug(s.name)}
            className={`w-full flex flex-col gap-0.5 px-3 py-2 rounded text-left text-[12px] transition-colors mb-0.5
              ${activeKnowledgeSlug === s.name
                ? 'bg-[var(--color-surface-2)] text-[var(--color-text)]'
                : 'text-[var(--color-text-muted)] hover:bg-[var(--color-surface-2)]'}`}
          >
            <span className="font-medium truncate">{s.name}</span>
            <span className="text-[11px] text-[var(--color-text-dim)] truncate">{s.description?.slice(0, 50)}</span>
          </button>
        ))}
      </div>
    </>
  )
}

// ======================== 共享 UI ========================

function PanelHeader({ title, action }: { title: string; action?: { label: string; onClick: () => void } }) {
  return (
    <div className="flex items-center justify-between px-3 py-2.5 border-b border-[var(--color-border)]">
      <span className="text-[13px] font-semibold text-[var(--color-text)]">
        {title}
      </span>
      {action && (
        <button type="button" onClick={action.onClick}
          className="orca-btn-link text-[12px]">
          {action.label}
        </button>
      )}
    </div>
  )
}

function ActiveBar() {
  return <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[2px] h-4 bg-[var(--color-accent)] rounded-r" />
}

function EmptyHint({ children }: { children: React.ReactNode }) {
  return <div className="px-3 py-4 text-[11px] text-[var(--color-text-dim)] italic">{children}</div>
}

function formatShort(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const sameDay = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()
  if (sameDay) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  const diff = Math.floor((now.getTime() - d.getTime()) / 86400000)
  if (diff === 1) return '昨天'
  if (diff < 7) return `${diff}天前`
  return d.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })
}
