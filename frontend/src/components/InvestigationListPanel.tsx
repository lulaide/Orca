import { useEffect, useMemo, useState } from 'react'
import {
  listInvestigations,
  type Investigation,
  type InvestigationView,
} from '../api'
import { navigate } from '../navigate'
import { InvestigationCreateDialog } from './InvestigationCreateDialog'
import { SeverityDot, StatusBadge } from './investigationUI'
import { formatRelativeTime } from '../timeFormat'

interface Props {
  view: InvestigationView
  refreshToken: number
  onChanged: () => void
}

const VIEWS: { key: InvestigationView; label: string }[] = [
  { key: 'active', label: '进行中' },
  { key: 'resolved', label: '已解决' },
  { key: 'archived', label: '已归档' },
  { key: 'all', label: '全部' },
]

function pushView(view: InvestigationView) {
  const next = view === 'active' ? '/i' : `/i?view=${view}`
  navigate(next)
}

export function InvestigationListPanel({ view, refreshToken, onChanged }: Props) {
  const [items, setItems] = useState<Investigation[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  // 展示用的分类计数（只在挂载和 refresh 时拉 all 汇总）
  const [all, setAll] = useState<Investigation[] | null>(null)

  useEffect(() => {
    let cancelled = false
    listInvestigations({ view })
      .then((data) => {
        if (cancelled) return
        setItems(data)
        setErr(null)
      })
      .catch((e) => {
        if (cancelled) return
        setErr(e.message || '加载失败')
      })
    return () => {
      cancelled = true
    }
  }, [view, refreshToken])

  useEffect(() => {
    let cancelled = false
    listInvestigations({ view: 'all' })
      .then((data) => {
        if (!cancelled) setAll(data)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [refreshToken])

  const counts = useMemo(() => {
    const c = { active: 0, resolved: 0, archived: 0, all: 0 }
    if (!all) return c
    for (const it of all) {
      c.all++
      if (it.archived_at) c.archived++
      else if (it.status === 'resolved') c.resolved++
      else if (it.status === 'open' || it.status === 'investigating') c.active++
    }
    return c
  }, [all])

  return (
    <div className="flex flex-col flex-1 min-h-0 h-full">
      <InvestigationCreateDialog
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onCreated={(inv) => {
          setShowCreate(false)
          onChanged()
          navigate(`/i/${inv.id}`)
        }}
      />
      {/* Header */}
      <header className="flex items-center justify-between px-6 h-11 border-b border-[var(--color-border)] bg-[var(--color-bg)] font-mono text-[11px]">
        <div className="flex items-center gap-2 text-[var(--color-text-dim)]">
          <span className="text-[var(--color-accent)]">~</span>
          <span>/</span>
          <span>orca</span>
          <span>/</span>
          <span className="text-[var(--color-text-muted)]">investigations</span>
        </div>
        <button
          type="button"
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-1.5 px-2.5 h-7 rounded
            bg-[var(--color-accent)] text-[var(--color-bg)]
            hover:bg-[var(--color-accent-hover)]
            font-mono text-[12px] uppercase tracking-[0.15em] transition-colors"
        >
          <span className="leading-none">+</span>
          <span>新建</span>
        </button>
      </header>

      {/* Tab bar */}
      <div className="sticky top-0 z-10 flex items-end gap-5 px-6 pt-4 border-b border-[var(--color-border)] bg-[var(--color-bg)]">
        {VIEWS.map((v) => {
          const active = v.key === view
          return (
            <button
              key={v.key}
              type="button"
              onClick={() => pushView(v.key)}
              className={`relative -mb-px pb-2.5 px-0.5 font-mono text-[11.5px] uppercase tracking-[0.14em] transition-colors
                ${active
                  ? 'text-[var(--color-text)]'
                  : 'text-[var(--color-text-dim)] hover:text-[var(--color-text-muted)]'}`}
            >
              <span>{v.label}</span>
              <span className="ml-1.5 text-[11.5px] text-[var(--color-text-dim)] tabular-nums">
                {counts[v.key as keyof typeof counts]}
              </span>
              {active && (
                <span className="absolute left-0 right-0 -bottom-px h-[2px] bg-[var(--color-accent)]" />
              )}
            </button>
          )
        })}
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto orca-grid">
        <div className="max-w-3xl mx-auto px-6 py-6">
          {err && (
            <div className="text-[13px] text-[var(--color-danger)] font-mono">{err}</div>
          )}
          {items === null && !err && (
            <div className="text-[12.5px] text-[var(--color-text-dim)] italic">加载中…</div>
          )}
          {items && items.length === 0 && (
            <EmptyView onCreate={() => setShowCreate(true)} />
          )}
          {items && items.length > 0 && (
            <div className="space-y-2">
              {items.map((inv) => (
                <InvestigationRow key={inv.id} inv={inv} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function InvestigationRow({ inv }: { inv: Investigation }) {
  const archived = !!inv.archived_at
  return (
    <button
      type="button"
      onClick={() => navigate(`/i/${inv.id}`)}
      className={`w-full text-left rounded-md border px-4 py-3 transition-colors
        border-[var(--color-border)]
        hover:border-[var(--color-border-strong)]
        hover:bg-[var(--color-surface)]
        ${archived ? 'opacity-60' : ''}`}
    >
      <div className="flex items-center gap-2 mb-1">
        <SeverityDot severity={inv.severity} />
        <span
          className={`font-semibold text-[17px] text-[var(--color-text)] flex-1 truncate
            ${archived ? 'line-through decoration-[var(--color-text-dim)]' : ''}`}
        >
          {inv.title}
        </span>
        <StatusBadge status={inv.status} />
        {archived && (
          <span className="text-[11px] font-mono uppercase tracking-[0.2em] text-[var(--color-text-dim)] border border-[var(--color-border)] px-1.5 py-0.5 rounded">
            archived
          </span>
        )}
      </div>
      <div className="flex items-center gap-3 text-[11px] font-mono text-[var(--color-text-dim)]">
        <span className="tabular-nums">{formatRelativeTime(inv.updated_at)}</span>
        {inv.source && <span>· {inv.source}</span>}
        {inv.related_services && inv.related_services.length > 0 && (
          <span className="truncate">
            · {inv.related_services.slice(0, 2).join(', ')}
            {inv.related_services.length > 2 && ` +${inv.related_services.length - 2}`}
          </span>
        )}
      </div>
    </button>
  )
}

function EmptyView({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="py-10 orca-fade-in">
      <div className="text-[11.5px] uppercase tracking-[0.25em] text-[var(--color-text-dim)] font-mono mb-3">
        empty · 空
      </div>
      <h2 className="font-semibold text-[32px] leading-tight text-[var(--color-text)] mb-3">
        还没有任何调查
      </h2>
      <p className="text-[13px] text-[var(--color-text-muted)] mb-5 leading-relaxed max-w-md">
        调查是 Orca 中一个待解决问题的持久记录——当 AI 在对话里发现要跨时间跟进的问题，会自动开一条；你也可以手工新建。
      </p>
      <button
        type="button"
        onClick={onCreate}
        className="px-3 h-8 rounded bg-[var(--color-accent)] text-[var(--color-bg)]
          hover:bg-[var(--color-accent-hover)]
          font-mono text-[11px] uppercase tracking-[0.15em] transition-colors"
      >
        新建一个
      </button>
    </div>
  )
}

