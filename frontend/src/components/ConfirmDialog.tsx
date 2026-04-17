import { useEffect, useRef } from 'react'

interface Props {
  open: boolean
  /** 左上角的 mono tag，配合场景比如 "rm" / "stop" / "reset"（对应 shell 语义） */
  tag?: string
  title: string
  description?: string
  /** 作用对象——用类似命令行中的 `> subject` 形式强调 */
  subject?: string
  confirmLabel: string
  cancelLabel?: string
  /** 危险操作：按钮用 --color-danger */
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({
  open,
  tag,
  title,
  description,
  subject,
  confirmLabel,
  cancelLabel = '取消',
  danger = false,
  onConfirm,
  onCancel,
}: Props) {
  const cancelBtnRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onCancel()
      }
    }
    window.addEventListener('keydown', onKey)
    // 默认焦点停在"取消"——破坏性操作不接受回车直接触发
    const t = setTimeout(() => cancelBtnRef.current?.focus(), 0)
    // 锁 body 滚动
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      clearTimeout(t)
      document.body.style.overflow = prev
    }
  }, [open, onCancel])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-6
        bg-black/40 backdrop-blur-[1px] orca-fade-in"
      onClick={onCancel}
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
    >
      <div
        className="w-full max-w-md rounded-lg border border-[var(--color-border-strong)]
          bg-[var(--color-surface)] shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部 tag 条——沿用整站的命令行路径语感 */}
        <div className="flex items-center justify-between px-5 h-9 border-b border-[var(--color-border)] bg-[var(--color-bg)]">
          <div className="flex items-center gap-2 font-mono text-[12px] uppercase tracking-[0.22em]">
            <span className={danger ? 'text-[var(--color-danger)]' : 'text-[var(--color-accent)]'}>
              {tag ?? 'confirm'}
            </span>
            <span className="text-[var(--color-text-dim)] opacity-60">/</span>
            <span className="text-[var(--color-text-dim)]">确认操作</span>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="w-6 h-6 grid place-items-center rounded
              text-[var(--color-text-dim)] hover:text-[var(--color-text)]
              hover:bg-[var(--color-surface-2)] transition-colors"
            aria-label="关闭"
          >
            <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        {/* 主体 */}
        <div className="px-5 pt-5 pb-4">
          <h2
            id="confirm-dialog-title"
            className="font-serif-display text-[24px] leading-tight text-[var(--color-text)] mb-2"
          >
            {title}
          </h2>
          {description && (
            <p className="text-[13px] text-[var(--color-text-muted)] leading-relaxed">
              {description}
            </p>
          )}
          {subject && (
            <div className="mt-3 flex items-start gap-2 px-3 py-2 rounded-md bg-[var(--color-bg)] border border-[var(--color-border)]">
              <span className="shrink-0 font-mono text-[var(--color-text-dim)] text-[12px] pt-[2px] select-none">
                &gt;
              </span>
              <span className="flex-1 min-w-0 text-[13px] text-[var(--color-text)] truncate">
                {subject}
              </span>
            </div>
          )}
        </div>

        {/* 操作区 */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-[var(--color-border)] bg-[var(--color-bg)]">
          <button
            ref={cancelBtnRef}
            type="button"
            onClick={onCancel}
            className="px-3 h-8 rounded
              border border-[var(--color-border-strong)]
              bg-transparent text-[var(--color-text)]
              hover:bg-[var(--color-surface-2)]
              font-mono text-[11px] uppercase tracking-[0.15em]
              transition-colors"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`px-3 h-8 rounded text-[var(--color-bg)]
              font-mono text-[11px] uppercase tracking-[0.15em]
              transition-colors
              ${
                danger
                  ? 'bg-[var(--color-danger)] hover:brightness-110'
                  : 'bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)]'
              }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
