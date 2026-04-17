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

export function StatusBadge({ status }: { status: InvestigationStatus }) {
  const label: Record<InvestigationStatus, string> = {
    open: 'open',
    investigating: 'invest.',
    resolved: 'resolved',
    stale: 'stale',
  }
  const cls: Record<InvestigationStatus, string> = {
    open: 'text-[var(--color-accent)] border-[var(--color-accent)]/40',
    investigating: 'text-[var(--color-warn)] border-[var(--color-warn)]/40',
    resolved: 'text-[var(--color-ok)] border-[var(--color-ok)]/40',
    stale: 'text-[var(--color-text-dim)] border-[var(--color-border)]',
  }
  return (
    <span
      className={`text-[11px] font-mono uppercase tracking-[0.18em] px-1.5 py-0.5 border rounded ${cls[status]}`}
    >
      {label[status]}
    </span>
  )
}

