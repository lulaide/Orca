import type { ReferencedInvestigation } from '../api'
import { navigate } from '../navigate'
import { SeverityDot, StatusBadge } from './investigationUI'

// 用户消息 bubble 上方的展示型：点击跳 /i/{id}
export function InvestigationReferenceCard({ inv }: { inv: ReferencedInvestigation }) {
  return (
    <button
      type="button"
      onClick={() => navigate(`/i/${inv.id}`)}
      className="w-full text-left rounded-md border border-[var(--color-border-strong)]
        bg-[var(--color-surface)] px-3 py-2 flex items-center gap-2
        hover:border-[var(--color-accent)] hover:bg-[var(--color-accent-soft)]
        transition-colors"
    >
      <SeverityDot severity={inv.severity} />
      <span className="flex-1 truncate text-[13px] text-[var(--color-text)]">
        {inv.title || '未命名调查'}
      </span>
      <StatusBadge status={inv.status} />
      <span className="font-mono text-[10.5px] text-[var(--color-text-dim)] shrink-0">
        {inv.id.slice(0, 6)}
      </span>
    </button>
  )
}

// composer 上方的草稿型：带 × 移除按钮
export function InvestigationReferenceDraftChip({
  inv,
  onRemove,
}: {
  inv: ReferencedInvestigation
  onRemove: () => void
}) {
  return (
    <span
      className="inline-flex items-center gap-1.5 pl-2 pr-1 py-0.5 rounded-md
        border border-[var(--color-border-strong)] bg-[var(--color-surface)]
        text-[12px] max-w-[320px]"
    >
      <SeverityDot severity={inv.severity} />
      <span className="truncate text-[var(--color-text)]">
        {inv.title || '未命名调查'}
      </span>
      <span className="font-mono text-[10.5px] text-[var(--color-text-dim)] shrink-0">
        {inv.id.slice(0, 6)}
      </span>
      <button
        type="button"
        onClick={onRemove}
        className="ml-1 w-4 h-4 inline-flex items-center justify-center rounded
          text-[var(--color-text-dim)] hover:text-[var(--color-text)]
          hover:bg-[var(--color-surface-hover)]"
        aria-label="移除引用"
      >
        ×
      </button>
    </span>
  )
}
