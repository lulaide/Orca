import { useEffect, useMemo, useState } from 'react'
import { listEvents, type OrcaEvent } from '../api'
import { navigate } from '../navigate'
import { SeverityDot } from './investigationUI'
import { formatRelativeTime } from '../timeFormat'

type EventView = 'all' | 'unprocessed' | 'critical'

interface Props {
  refreshToken: number
}

const VIEWS: { key: EventView; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'unprocessed', label: '未处理' },
  { key: 'critical', label: 'critical' },
]

export function EventsListPanel({ refreshToken }: Props) {
  const [view, setView] = useState<EventView>('all')
  const [items, setItems] = useState<OrcaEvent[] | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const opts =
      view === 'unprocessed'
        ? { processed: false, limit: 100 }
        : view === 'critical'
        ? { severity: 'critical', limit: 100 }
        : { limit: 100 }
    listEvents(opts)
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

  const counts = useMemo(() => {
    const c = { all: 0, unprocessed: 0, critical: 0 }
    if (!items) return c
    for (const e of items) {
      c.all++
      if (!e.processed_at) c.unprocessed++
      if (e.severity === 'critical') c.critical++
    }
    return c
  }, [items])

  return (
    <div className="flex flex-col flex-1 min-h-0 h-full">
      <header className="flex items-center justify-between px-6 h-11 border-b border-[var(--color-border)] bg-[var(--color-bg)] font-mono text-[11px]">
        <div className="flex items-center gap-2 text-[var(--color-text-dim)]">
          <span className="text-[var(--color-accent)]">~</span>
          <span>/</span>
          <span>orca</span>
          <span>/</span>
          <span className="text-[var(--color-text-muted)]">events</span>
        </div>
      </header>

      <div className="sticky top-0 z-10 flex items-end gap-5 px-6 pt-4 border-b border-[var(--color-border)] bg-[var(--color-bg)]">
        {VIEWS.map((v) => {
          const active = v.key === view
          return (
            <button
              key={v.key}
              type="button"
              onClick={() => setView(v.key)}
              className={`relative -mb-px pb-2.5 px-0.5 font-mono text-[11.5px] uppercase tracking-[0.14em] transition-colors
                ${active
                  ? 'text-[var(--color-text)]'
                  : 'text-[var(--color-text-dim)] hover:text-[var(--color-text-muted)]'}`}
            >
              <span>{v.label}</span>
              <span className="ml-1.5 text-[11.5px] text-[var(--color-text-dim)] tabular-nums">
                {counts[v.key]}
              </span>
              {active && (
                <span className="absolute left-0 right-0 -bottom-px h-[2px] bg-[var(--color-accent)]" />
              )}
            </button>
          )
        })}
      </div>

      <div className="flex-1 overflow-y-auto orca-grid">
        <div className="max-w-3xl mx-auto px-6 py-6">
          {err && (
            <div className="text-[13px] text-[var(--color-danger)] font-mono">{err}</div>
          )}
          {items === null && !err && (
            <div className="text-[12.5px] text-[var(--color-text-dim)] italic">加载中…</div>
          )}
          {items && items.length === 0 && <EmptyView />}
          {items && items.length > 0 && (
            <div className="space-y-2">
              {items.map((ev) => (
                <EventRow key={ev.id} ev={ev} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function EventRow({ ev }: { ev: OrcaEvent }) {
  const processed = !!ev.processed_at

  return (
    <button
      type="button"
      onClick={() => navigate(`/events/${ev.id}`)}
      className="w-full text-left rounded-md border border-[var(--color-border)]
        hover:border-[var(--color-border-strong)] hover:bg-[var(--color-surface)]
        transition-colors px-4 py-3"
    >
      <div className="flex items-center gap-2 mb-1">
        <SeverityDot severity={ev.severity} />
        <span className="font-semibold text-[17px] text-[var(--color-text)] flex-1 truncate">
          {ev.title}
        </span>
        {!processed && (
          <span className="text-[11px] font-mono uppercase tracking-[0.18em] px-1.5 py-0.5 border rounded text-[var(--color-warn)] border-[var(--color-warn)]/40">
            pending
          </span>
        )}
        {processed && (
          <span className="text-[11px] font-mono uppercase tracking-[0.18em] px-1.5 py-0.5 border rounded text-[var(--color-ok)] border-[var(--color-ok)]/40">
            done
          </span>
        )}
      </div>
      <div className="flex items-center gap-3 text-[11px] font-mono text-[var(--color-text-dim)]">
        <span className="tabular-nums">{formatRelativeTime(ev.created_at)}</span>
        <span>· {ev.source}</span>
        {ev.related_services && ev.related_services.length > 0 && (
          <span className="truncate">
            · {ev.related_services.slice(0, 2).join(', ')}
            {ev.related_services.length > 2 && ` +${ev.related_services.length - 2}`}
          </span>
        )}
      </div>
      {ev.agent_summary && (
        <div className="mt-2 text-[12.5px] text-[var(--color-text-muted)] leading-relaxed line-clamp-2">
          {ev.agent_summary}
        </div>
      )}
    </button>
  )
}

function EmptyView() {
  return (
    <div className="py-10 orca-fade-in">
      <div className="text-[11.5px] uppercase tracking-[0.25em] text-[var(--color-text-dim)] font-mono mb-3">
        empty · 空
      </div>
      <h2 className="font-semibold text-[32px] leading-tight text-[var(--color-text)] mb-3">
        还没有任何事件
      </h2>
      <p className="text-[13px] text-[var(--color-text-muted)] mb-5 leading-relaxed max-w-md">
        事件来自告警源（如 UptimeKuma）的 Webhook。配置一个触发插件并把 Orca 的 Webhook URL
        粘到告警源的通知里，事件就会自动出现在这里，Agent 会自主决定要不要开调查。
      </p>
    </div>
  )
}
