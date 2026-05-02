import { useState } from 'react'
import type { ToolCall } from '../api'
import { approveAction, rejectAction } from '../api'

interface Props {
  toolCall: ToolCall
  output?: string
  pendingApproval?: { id: string; tool_name: string; description: string; risk: string }
}

interface ApprovalData {
  approval_required: boolean
  action_id: string
  description: string
  status: string
}

function parseApproval(output: string | undefined): ApprovalData | null {
  if (!output) return null
  try {
    const data = JSON.parse(output)
    if (data?.approval_required && data?.action_id) return data
  } catch { /* not JSON */ }
  return null
}

function prettyJSON(s: string): string {
  try {
    return JSON.stringify(JSON.parse(s), null, 2)
  } catch {
    return s
  }
}

export function ToolCallCard({ toolCall, output, pendingApproval }: Props) {
  const [open, setOpen] = useState(false)
  const [approvalStatus, setApprovalStatus] = useState<'pending' | 'approved' | 'rejected' | null>(null)
  const [busy, setBusy] = useState(false)

  const running = output === undefined
  const name = toolCall.function.name
  const approval = pendingApproval || parseApproval(output)
  const isApprovalPending = !approvalStatus && approval && (pendingApproval || (approval as ApprovalData).status === 'pending')
  const isError = !running && !approval && output!.startsWith('ERROR:')
  const wasRejected = approvalStatus === 'rejected' || (!running && output === '操作被用户拒绝')

  const approvalId = pendingApproval?.id || (approval as ApprovalData | null)?.action_id

  const handleApprove = async () => {
    if (!approvalId) return
    setBusy(true)
    try {
      await approveAction(approvalId)
      setApprovalStatus('approved')
    } catch { /* */ }
    setBusy(false)
  }

  const handleReject = async () => {
    if (!approvalId) return
    setBusy(true)
    try {
      await rejectAction(approvalId)
      setApprovalStatus('rejected')
    } catch { /* */ }
    setBusy(false)
  }

  // 状态显示
  let stateLabel: string
  let stateColor: string
  let stateIcon: React.ReactNode

  if (running) {
    stateLabel = '运行中'
    stateColor = 'text-[var(--color-accent)]'
    stateIcon = (
      <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.3" strokeWidth="2.5" />
        <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      </svg>
    )
  } else if (isApprovalPending) {
    stateLabel = '等待确认'
    stateColor = 'text-[var(--color-warn)]'
    stateIcon = (
      <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
        <circle cx="12" cy="12" r="10" />
        <path d="M12 8v4M12 16h.01" />
      </svg>
    )
  } else if (wasRejected) {
    stateLabel = '已拒绝'
    stateColor = 'text-[var(--color-text-dim)]'
    stateIcon = (
      <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
        <circle cx="12" cy="12" r="10" />
        <path d="M15 9l-6 6M9 9l6 6" />
      </svg>
    )
  } else if (isError) {
    stateLabel = '失败'
    stateColor = 'text-[var(--color-danger)]'
    stateIcon = (
      <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
        <circle cx="12" cy="12" r="10" />
        <path d="M15 9l-6 6M9 9l6 6" />
      </svg>
    )
  } else {
    stateLabel = '完成'
    stateColor = 'text-[var(--color-ok)]'
    stateIcon = (
      <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <path d="M9 12l2 2 4-4" />
      </svg>
    )
  }

  return (
    <div className="relative my-2 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden orca-fade-in">
      {running && (
        <div className="absolute inset-x-0 top-0 h-[1px] orca-shimmer pointer-events-none" />
      )}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-[var(--color-surface-2)] text-left transition-colors"
      >
        <svg
          viewBox="0 0 24 24"
          className={`w-3 h-3 shrink-0 text-[var(--color-text-dim)] transition-transform ${open ? 'rotate-90' : ''}`}
          fill="currentColor"
        >
          <path d="M8 5l8 7-8 7V5z" />
        </svg>
        <span className="font-mono text-xs text-[var(--color-text-dim)]">$</span>
        <code className="font-mono text-[12.5px] text-[var(--color-accent)]">{name}</code>
        <span className="flex-1" />

        {/* 审批按钮 */}
        {isApprovalPending && (
          <span className="flex items-center gap-1.5 mr-2" onClick={(e) => e.stopPropagation()}>
            <button type="button" onClick={handleApprove} disabled={busy}
              className="px-2 py-0.5 rounded text-[11px] font-medium bg-[var(--color-ok)]/10 text-[var(--color-ok)] border border-[var(--color-ok)]/20
                hover:bg-[var(--color-ok)]/20 disabled:opacity-50 transition-colors">
              ✓ 确认
            </button>
            <button type="button" onClick={handleReject} disabled={busy}
              className="px-2 py-0.5 rounded text-[11px] font-medium bg-[var(--color-surface-2)] text-[var(--color-text-dim)] border border-[var(--color-border)]
                hover:text-[var(--color-danger)] hover:border-[var(--color-danger)]/30 disabled:opacity-50 transition-colors">
              ✗ 拒绝
            </button>
          </span>
        )}

        <span className={`flex items-center gap-1 text-[12px] ${stateColor}`}>
          {stateIcon}
          {stateLabel}
        </span>
      </button>

      {/* 审批描述 */}
      {isApprovalPending && approval?.description && (
        <div className="px-3 py-1.5 border-t border-[var(--color-border)] text-[12px] text-[var(--color-warn)] bg-[var(--color-warn)]/5">
          等待确认：{approval.description}
        </div>
      )}

      {open && (
        <div className="px-3 pb-2.5 pt-1 border-t border-[var(--color-border)] space-y-2 orca-fade-in">
          <div>
            <div className="text-[12px] font-medium text-[var(--color-text-dim)] mb-1">输入</div>
            <pre className="bg-[var(--color-bg)] border border-[var(--color-border)] p-2 rounded overflow-x-auto text-[11.5px] font-mono text-[var(--color-text-muted)] leading-[1.55]">
              {prettyJSON(toolCall.function.arguments)}
            </pre>
          </div>
          {!running && !approval && (
            <div>
              <div className="text-[12px] font-medium text-[var(--color-text-dim)] mb-1">输出</div>
              <pre
                className={`bg-[var(--color-bg)] border border-[var(--color-border)] p-2 rounded overflow-x-auto whitespace-pre-wrap text-[11.5px] font-mono leading-[1.55] ${
                  isError ? 'text-[var(--color-danger)]' : 'text-[var(--color-text-muted)]'
                }`}
              >
                {output}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
