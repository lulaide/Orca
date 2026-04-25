import { useEffect, useState } from 'react'
import { getInvestigation, type Investigation, type ToolCall } from '../api'
import { navigate } from '../navigate'
import { SeverityDot, StatusBadge } from './investigationUI'

interface Props {
  toolCall: ToolCall
  output?: string
}

// 从工具输出（JSON）里提取初始 shape；失败就返回 null
function parseInitial(output?: string): Partial<Investigation> | null {
  if (!output) return null
  if (output.startsWith('ERROR:')) return null
  try {
    const raw = JSON.parse(output)
    if (!raw || typeof raw !== 'object') return null
    return raw as Partial<Investigation>
  } catch {
    return null
  }
}

export function InvestigationRefCard({ toolCall, output }: Props) {
  const initial = parseInitial(output)
  const [inv, setInv] = useState<Partial<Investigation> | null>(initial)
  const running = output === undefined
  const isError = !running && output.startsWith('ERROR:')

  useEffect(() => {
    if (!initial?.id) return
    let cancelled = false
    getInvestigation(initial.id)
      .then((fresh) => {
        if (!cancelled) setInv(fresh)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [initial?.id])

  if (running) {
    return (
      <div className="my-2 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 flex items-center gap-2 orca-fade-in">
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-[var(--color-accent)] orca-pulse-dot" />
        <span className="font-mono text-[11.5px] text-[var(--color-accent)]">{toolCall.function.name}</span>
        <span className="text-[11px] text-[var(--color-text-dim)]">创建调查中…</span>
      </div>
    )
  }
  if (isError || !inv || !inv.id) {
    return (
      <div className="my-2 rounded-md border border-[var(--color-danger)]/40 bg-[var(--color-surface)] px-3 py-2 flex items-center gap-2 orca-fade-in">
        <span className="font-mono text-[11.5px] text-[var(--color-danger)]">{toolCall.function.name}</span>
        <span className="text-[11px] text-[var(--color-text-muted)] truncate">
          {output ?? '无输出'}
        </span>
      </div>
    )
  }

  const archived = !!inv.archived_at
  return (
    <button
      type="button"
      onClick={() => navigate(`/i/${inv.id}`)}
      className={`my-2 w-full text-left rounded-md border border-[var(--color-border-strong)]
        bg-[var(--color-surface)] px-4 py-3 flex items-stretch gap-3
        hover:border-[var(--color-accent)] hover:bg-[var(--color-accent-soft)]
        transition-colors orca-fade-in
        ${archived ? 'opacity-60' : ''}`}
    >
      <span className="w-[3px] rounded-full bg-[var(--color-accent)] shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          {inv.severity && <SeverityDot severity={inv.severity} />}
          <span
            className={`font-semibold text-[16px] text-[var(--color-text)] flex-1 truncate
              ${archived ? 'line-through decoration-[var(--color-text-dim)]' : ''}`}
          >
            {inv.title || '未命名调查'}
          </span>
          {inv.status && <StatusBadge status={inv.status} />}
          {archived && (
            <span className="text-[11px] font-medium text-[var(--color-text-dim)] border border-[var(--color-border)] px-1.5 py-0.5 rounded">
              已归档
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 text-[11px] font-mono text-[var(--color-text-dim)]">
          <span>调查 · investigation</span>
          <span>·</span>
          <span className="truncate">{inv.id.slice(0, 12)}</span>
          <span className="ml-auto text-[var(--color-accent)]">查看 →</span>
        </div>
      </div>
    </button>
  )
}
