import { useEffect, useRef, useState } from 'react'
import {
  createInvestigation,
  type Investigation,
  type InvestigationSeverity,
} from '../api'

interface Props {
  open: boolean
  onClose: () => void
  onCreated: (inv: Investigation) => void
}

export function InvestigationCreateDialog({ open, onClose, onCreated }: Props) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [severity, setSeverity] = useState<InvestigationSeverity>('info')
  const [servicesText, setServicesText] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const titleRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    setTitle('')
    setDescription('')
    setSeverity('info')
    setServicesText('')
    setErr(null)
    setBusy(false)
    const t = setTimeout(() => titleRef.current?.focus(), 0)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      clearTimeout(t)
      document.body.style.overflow = prev
      window.removeEventListener('keydown', onKey)
    }
  }, [open, onClose])

  if (!open) return null

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const t = title.trim()
    if (!t || busy) return
    const related = servicesText
      .split(/[,，;\s]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
    setBusy(true)
    setErr(null)
    try {
      const inv = await createInvestigation({
        title: t,
        description: description.trim(),
        severity,
        source: 'manual',
        related_services: related.length > 0 ? related : undefined,
      })
      onCreated(inv)
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : '创建失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-6
        bg-black/40 backdrop-blur-[1px] orca-fade-in"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg rounded-lg border border-[var(--color-border-strong)]
          bg-[var(--color-surface)] shadow-2xl overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 h-9 border-b border-[var(--color-border)] bg-[var(--color-bg)]">
          <div className="flex items-center gap-2 font-mono text-[12px] uppercase tracking-[0.22em]">
            <span className="text-[var(--color-accent)]">new</span>
            <span className="text-[var(--color-text-dim)] opacity-60">/</span>
            <span className="text-[var(--color-text-dim)]">investigation</span>
          </div>
          <button
            type="button"
            onClick={onClose}
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

        {/* Body */}
        <div className="px-5 pt-5 pb-4 space-y-4">
          <div>
            <label className="block text-[11.5px] uppercase tracking-[0.2em] text-[var(--color-text-dim)] font-mono mb-1.5">
              标题 *
            </label>
            <input
              ref={titleRef}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="API gateway 5xx spike"
              className="w-full px-3 h-9 rounded border border-[var(--color-border-strong)]
                bg-[var(--color-bg)] text-[14px] text-[var(--color-text)]
                focus:border-[var(--color-text)] focus:outline-none transition-colors"
            />
          </div>
          <div>
            <label className="block text-[11.5px] uppercase tracking-[0.2em] text-[var(--color-text-dim)] font-mono mb-1.5">
              描述
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="初步观察、假设、影响面…（支持 markdown）"
              rows={4}
              className="w-full px-3 py-2 rounded border border-[var(--color-border-strong)]
                bg-[var(--color-bg)] text-[14px] text-[var(--color-text)] leading-relaxed
                focus:border-[var(--color-text)] focus:outline-none transition-colors resize-none"
            />
          </div>
          <div className="flex items-start gap-4">
            <div className="w-32 shrink-0">
              <label className="block text-[11.5px] uppercase tracking-[0.2em] text-[var(--color-text-dim)] font-mono mb-1.5">
                严重度
              </label>
              <select
                value={severity}
                onChange={(e) => setSeverity(e.target.value as InvestigationSeverity)}
                className="w-full px-2 h-9 rounded border border-[var(--color-border-strong)]
                  bg-[var(--color-bg)] text-[13px] text-[var(--color-text)]
                  focus:border-[var(--color-text)] focus:outline-none transition-colors"
              >
                <option value="info">info</option>
                <option value="warning">warning</option>
                <option value="critical">critical</option>
              </select>
            </div>
            <div className="flex-1 min-w-0">
              <label className="block text-[11.5px] uppercase tracking-[0.2em] text-[var(--color-text-dim)] font-mono mb-1.5">
                相关服务（逗号或空格分隔）
              </label>
              <input
                value={servicesText}
                onChange={(e) => setServicesText(e.target.value)}
                placeholder="api-gateway, checkout"
                className="w-full px-3 h-9 rounded border border-[var(--color-border-strong)]
                  bg-[var(--color-bg)] text-[13px] text-[var(--color-text)] font-mono
                  focus:border-[var(--color-text)] focus:outline-none transition-colors"
              />
            </div>
          </div>
          {err && (
            <div className="text-[12px] text-[var(--color-danger)] font-mono">{err}</div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-[var(--color-border)] bg-[var(--color-bg)]">
          <button
            type="button"
            onClick={onClose}
            className="px-3 h-8 rounded border border-[var(--color-border-strong)]
              bg-transparent text-[var(--color-text)]
              hover:bg-[var(--color-surface-2)]
              font-mono text-[11px] uppercase tracking-[0.15em] transition-colors"
          >
            取消
          </button>
          <button
            type="submit"
            disabled={busy || !title.trim()}
            className="px-3 h-8 rounded text-[var(--color-bg)]
              bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)]
              disabled:bg-[var(--color-surface-3)] disabled:text-[var(--color-text-dim)]
              disabled:cursor-not-allowed
              font-mono text-[11px] uppercase tracking-[0.15em] transition-colors"
          >
            {busy ? '创建中…' : '创建'}
          </button>
        </div>
      </form>
    </div>
  )
}
