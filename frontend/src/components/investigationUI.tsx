import type { InvestigationSeverity, InvestigationStatus } from '../api'

export function SeverityDot({ severity }: { severity: InvestigationSeverity }) {
  const color =
    severity === 'critical'
      ? 'var(--color-danger)'
      : severity === 'warning'
      ? 'var(--color-warn)'
      : 'var(--color-text-dim)'
  return (
    <span
      className="inline-block w-2 h-2 rounded-full shrink-0"
      style={{ backgroundColor: color }}
      aria-label={severity}
    />
  )
}

export function SeverityBadge({ severity }: { severity: InvestigationSeverity }) {
  const label: Record<InvestigationSeverity, string> = {
    critical: '严重',
    warning: '警告',
    info: '信息',
  }
  const cls: Record<InvestigationSeverity, string> = {
    critical: 'bg-[var(--color-danger)]/10 text-[var(--color-danger)] border-[var(--color-danger)]/20',
    warning: 'bg-[var(--color-warn)]/10 text-[var(--color-warn)] border-[var(--color-warn)]/20',
    info: 'bg-[var(--color-surface-2)] text-[var(--color-text-dim)] border-[var(--color-border)]',
  }
  return (
    <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full border ${cls[severity]}`}>
      {label[severity]}
    </span>
  )
}

export function StatusBadge({ status }: { status: InvestigationStatus }) {
  const label: Record<InvestigationStatus, string> = {
    open: '待处理',
    investigating: '排查中',
    resolved: '已解决',
    stale: '已过期',
  }
  const cls: Record<InvestigationStatus, string> = {
    open: 'bg-[var(--color-accent-soft)] text-[var(--color-accent)] border-[var(--color-accent)]/20',
    investigating: 'bg-[var(--color-warn)]/10 text-[var(--color-warn)] border-[var(--color-warn)]/20',
    resolved: 'bg-[var(--color-ok)]/10 text-[var(--color-ok)] border-[var(--color-ok)]/20',
    stale: 'bg-[var(--color-surface-2)] text-[var(--color-text-dim)] border-[var(--color-border)]',
  }
  return (
    <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full border whitespace-nowrap shrink-0 ${cls[status]}`}>
      {label[status]}
    </span>
  )
}
