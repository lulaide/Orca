import { useEffect, useState } from 'react'
import {
  listConversations,
  deleteConversation,
  listEvents,
  listInvestigations,
  listKnowledgePages,
  type Conversation,
  type OrcaEvent,
  type Investigation,
  type KnowledgePage,
  type InvestigationView,
} from '../api'
import { navigate } from '../navigate'
import { SeverityDot } from './investigationUI'
import { formatRelativeTime } from '../timeFormat'
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
    <aside className="w-64 shrink-0 flex flex-col h-full border-r border-[var(--color-border)] bg-[var(--color-surface)]">
      {props.module === 'chat' && <ChatList {...props} />}
      {props.module === 'events' && <EventsList {...props} />}
      {props.module === 'investigations' && <InvestigationsList {...props} />}
      {props.module === 'knowledge' && <KnowledgeTree {...props} />}
    </aside>
  )
}

// ======================== Chat 会话列表 ========================

function ChatList({ refreshToken, activeConversationId, onSelectConversation }: Props) {
  const [convs, setConvs] = useState<Conversation[]>([])
  const [hoveredId, setHoveredId] = useState<string | null>(null)

  useEffect(() => {
    listConversations().then(setConvs).catch(console.error)
  }, [refreshToken])

  return (
    <>
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
              className={`group relative flex items-center gap-2 pl-3 pr-2 py-[7px] rounded-md cursor-pointer
                text-[12.5px] transition-colors
                ${active
                  ? 'bg-[var(--color-bg)] text-[var(--color-text)]'
                  : 'text-[var(--color-text-muted)] hover:bg-[var(--color-bg)] hover:text-[var(--color-text)]'}`}
            >
              {active && <ActiveBar />}
              <span className="flex-1 truncate">
                {c.title || <span className="italic text-[var(--color-text-dim)]">未命名</span>}
              </span>
              {hoveredId === c.id ? (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); deleteConversation(c.id).then(() => {
                    setConvs(prev => prev.filter(x => x.id !== c.id))
                    if (activeConversationId === c.id) onSelectConversation(null)
                  }) }}
                  className="shrink-0 w-5 h-5 grid place-items-center rounded text-[var(--color-text-dim)] hover:text-[var(--color-danger)]"
                >
                  <svg viewBox="0 0 24 24" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6" strokeLinecap="round" /></svg>
                </button>
              ) : (
                <span className="shrink-0 text-[10px] text-[var(--color-text-dim)] font-mono tabular-nums">
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
              className={`w-full text-left relative flex items-center gap-2 pl-3 pr-2 py-[7px] rounded-md
                text-[12.5px] transition-colors
                ${active
                  ? 'bg-[var(--color-bg)] text-[var(--color-text)]'
                  : 'text-[var(--color-text-muted)] hover:bg-[var(--color-bg)] hover:text-[var(--color-text)]'}`}
            >
              {active && <ActiveBar />}
              <SeverityDot severity={ev.severity} />
              <span className="flex-1 truncate">{ev.title}</span>
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
            className={`text-[10px] font-mono uppercase tracking-[0.12em] px-1.5 py-0.5 rounded transition-colors
              ${investigationView === v
                ? 'text-[var(--color-text)] bg-[var(--color-bg)]'
                : 'text-[var(--color-text-dim)] hover:text-[var(--color-text-muted)]'}`}
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
              className={`w-full text-left relative flex items-center gap-2 pl-3 pr-2 py-[7px] rounded-md
                text-[12.5px] transition-colors
                ${active
                  ? 'bg-[var(--color-bg)] text-[var(--color-text)]'
                  : 'text-[var(--color-text-muted)] hover:bg-[var(--color-bg)] hover:text-[var(--color-text)]'}`}
            >
              {active && <ActiveBar />}
              <SeverityDot severity={inv.severity} />
              <span className="flex-1 truncate">{inv.title}</span>
              <span className="text-[10px] font-mono text-[var(--color-text-dim)]">{inv.status}</span>
            </button>
          )
        })}
      </div>
    </>
  )
}

// ======================== Knowledge 文档目录 ========================

interface TreeNode {
  page: KnowledgePage
  children: TreeNode[]
}

function buildTree(pages: KnowledgePage[]): TreeNode[] {
  const map = new Map<string, TreeNode>()
  for (const p of pages) map.set(p.slug, { page: p, children: [] })
  const roots: TreeNode[] = []
  for (const p of pages) {
    const node = map.get(p.slug)!
    if (p.parent_slug && map.has(p.parent_slug)) {
      map.get(p.parent_slug)!.children.push(node)
    } else {
      roots.push(node)
    }
  }
  return roots
}

function KnowledgeTree({ refreshToken, activeKnowledgeSlug, onSelectKnowledgeSlug }: Props) {
  const [pages, setPages] = useState<KnowledgePage[]>([])

  useEffect(() => {
    listKnowledgePages().then(setPages).catch(console.error)
  }, [refreshToken])

  const tree = buildTree(pages)

  return (
    <>
      <PanelHeader title="知识库" action={{ label: '扫描', onClick: () => navigate('/knowledge?scan=1') }} />
      <div className="flex-1 overflow-y-auto px-2 py-1">
        {pages.length === 0 && <EmptyHint>尚未生成</EmptyHint>}
        {tree.map((node) => (
          <KnowledgeNavNode key={node.page.slug} node={node} depth={0}
            selected={activeKnowledgeSlug} onSelect={onSelectKnowledgeSlug} />
        ))}
      </div>
    </>
  )
}

function KnowledgeNavNode({ node, depth, selected, onSelect }: {
  node: TreeNode; depth: number; selected: string | null; onSelect: (slug: string) => void
}) {
  const [collapsed, setCollapsed] = useState(false)
  const active = node.page.slug === selected
  const has = node.children.length > 0

  return (
    <div>
      <button
        type="button"
        onClick={() => { onSelect(node.page.slug); if (has && active) setCollapsed(!collapsed) }}
        className={`w-full flex items-center gap-1 px-2 py-1 rounded text-left text-[12px] transition-colors
          ${active ? 'bg-[var(--color-bg)] text-[var(--color-text)]' : 'text-[var(--color-text-muted)] hover:bg-[var(--color-bg)]'}`}
        style={{ paddingLeft: `${6 + depth * 12}px` }}
      >
        {has && <span className="text-[9px] w-3 shrink-0 text-center" onClick={(e) => { e.stopPropagation(); setCollapsed(!collapsed) }}>{collapsed ? '▸' : '▾'}</span>}
        {!has && <span className="w-3 shrink-0" />}
        <span className="truncate">{node.page.title}</span>
      </button>
      {!collapsed && has && node.children.map((ch) => (
        <KnowledgeNavNode key={ch.page.slug} node={ch} depth={depth + 1} selected={selected} onSelect={onSelect} />
      ))}
    </div>
  )
}

// ======================== 共享 UI ========================

function PanelHeader({ title, action }: { title: string; action?: { label: string; onClick: () => void } }) {
  return (
    <div className="flex items-center justify-between px-3 py-2.5 border-b border-[var(--color-border)]">
      <span className="text-[11px] font-mono uppercase tracking-[0.18em] text-[var(--color-text-dim)]">
        {title}
      </span>
      {action && (
        <button type="button" onClick={action.onClick}
          className="text-[11px] font-mono text-[var(--color-accent)] hover:underline">
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
