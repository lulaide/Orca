import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import {
  getStatus,
  listInvestigations,
  type Investigation,
  type ReferencedInvestigation,
  type StatusResponse,
} from '../api'
import { navigate } from '../navigate'
import { SeverityDot, StatusBadge } from './investigationUI'
import { formatRelativeTime } from '../timeFormat'
import { ClusterMetricsCards } from './ClusterMetricsCards'
import { InvestigationPicker } from './InvestigationPicker'
import { InvestigationReferenceDraftChip } from './InvestigationReferenceCard'

interface Props {
  onSubmit: (text: string, refs: ReferencedInvestigation[]) => void
  focusSignal?: number
}

const LIMIT = 8

function greeting(now = new Date()): string {
  const h = now.getHours()
  if (h < 5) return '夜深了'
  if (h < 11) return '早上好'
  if (h < 13) return '午安'
  if (h < 18) return '下午好'
  return '晚上好'
}

function todayStr(now = new Date()): string {
  return now.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })
}

function toRefSummary(inv: Investigation): ReferencedInvestigation {
  return { id: inv.id, title: inv.title, severity: inv.severity, status: inv.status }
}

export function HomePanel({ onSubmit, focusSignal }: Props) {
  const [input, setInput] = useState('')
  const [referencedInvs, setReferencedInvs] = useState<ReferencedInvestigation[]>([])
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerQuery, setPickerQuery] = useState('')
  const [pickerAnchor, setPickerAnchor] = useState<{ x: number; y: number } | undefined>(undefined)
  const atTokenRef = useRef<{ start: number; end: number } | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // 挂载时聚焦；focusSignal 变化时重新聚焦（sidebar "+ 新对话" 触发）
  useEffect(() => {
    textareaRef.current?.focus()
  }, [focusSignal])

  // 自动 grow
  useEffect(() => {
    const ta = textareaRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = Math.min(ta.scrollHeight, 180) + 'px'
  }, [input])

  const submit = () => {
    const text = input.trim()
    if (!text) return
    const refs = referencedInvs
    setInput('')
    setReferencedInvs([])
    onSubmit(text, refs)
  }

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    submit()
  }

  const handleKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }

  // @ 触发 picker：扫描 cursor 前最近未结束的 @token
  const detectAtToken = () => {
    const ta = textareaRef.current
    if (!ta) return
    const pos = ta.selectionStart ?? 0
    const before = ta.value.slice(0, pos)
    const atIdx = before.lastIndexOf('@')
    if (atIdx < 0) {
      if (pickerAnchor) setPickerOpen(false)
      return
    }
    const token = before.slice(atIdx + 1)
    if (/\s/.test(token)) {
      if (pickerAnchor) setPickerOpen(false)
      return
    }
    atTokenRef.current = { start: atIdx, end: pos }
    setPickerQuery(token)
    const rect = ta.getBoundingClientRect()
    setPickerAnchor({ x: Math.max(8, rect.left + 12), y: rect.top - 8 })
    setPickerOpen(true)
  }

  const handleInput = () => {
    detectAtToken()
  }

  const toggleAttachPicker = () => {
    atTokenRef.current = null
    setPickerAnchor(undefined)
    setPickerQuery('')
    setPickerOpen((v) => !v)
  }

  const handlePick = (inv: Investigation) => {
    const ref = toRefSummary(inv)
    setReferencedInvs((prev) => (prev.some((r) => r.id === ref.id) ? prev : [...prev, ref]))
    const tok = atTokenRef.current
    if (tok) {
      const ta = textareaRef.current
      const v = ta?.value ?? input
      const next = v.slice(0, tok.start) + v.slice(tok.end)
      setInput(next)
      setTimeout(() => {
        if (ta) {
          ta.focus()
          ta.selectionStart = ta.selectionEnd = tok.start
        }
      }, 0)
    }
    atTokenRef.current = null
    setPickerOpen(false)
    setPickerQuery('')
  }

  return (
    <div className="flex flex-col flex-1 min-h-0 h-full overflow-y-auto orca-grid">
      <div className="w-full max-w-4xl mx-auto px-8 pt-[8vh] pb-16 flex flex-col gap-10">
        {/* Greeting */}
        <div className="orca-fade-in">
          <div className="text-[11.5px] uppercase tracking-[0.25em] text-[var(--color-text-dim)] font-mono mb-3">
            {todayStr()}
          </div>
          <h1 className="font-semibold text-[48px] leading-[1.02] text-[var(--color-text)] mb-2">
            {greeting()}
          </h1>
          <p className="text-[14px] text-[var(--color-text-muted)] max-w-md leading-relaxed">
            集群的眼睛·问一问，或先看看下面的状态摘要。
          </p>
        </div>

        {/* Prominent input */}
        <form onSubmit={handleSubmit} className="orca-fade-in">
          <div className="relative">
            {/* 挂在输入框上方的 attach 模式 picker */}
            {pickerOpen && !pickerAnchor && (
              <InvestigationPicker
                open={pickerOpen}
                searchQuery={pickerQuery}
                onSearchQueryChange={setPickerQuery}
                excludeIds={referencedInvs.map((r) => r.id)}
                onPick={handlePick}
                onClose={() => setPickerOpen(false)}
              />
            )}
            <div
              className="rounded-xl border border-[var(--color-border-strong)]
                bg-[var(--color-surface)]
                focus-within:border-[var(--color-text)]
                transition-colors shadow-sm"
            >
              {/* 草稿引用 chips */}
              {referencedInvs.length > 0 && (
                <div className="flex flex-wrap gap-1.5 px-4 pt-3 pb-2 border-b border-[var(--color-border)]">
                  {referencedInvs.map((r) => (
                    <InvestigationReferenceDraftChip
                      key={r.id}
                      inv={r}
                      onRemove={() =>
                        setReferencedInvs((prev) => prev.filter((x) => x.id !== r.id))
                      }
                    />
                  ))}
                </div>
              )}
              <div className="flex items-start gap-2 px-3 py-3">
                <button
                  type="button"
                  onClick={toggleAttachPicker}
                  className="shrink-0 w-9 h-9 mt-0.5 grid place-items-center rounded
                    text-[var(--color-text-dim)] hover:text-[var(--color-text)]
                    hover:bg-[var(--color-surface-2)] transition-colors"
                  aria-label="引用调查"
                  title="引用调查"
                >
                  <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                  </svg>
                </button>
                <span className="font-mono text-[var(--color-accent)] select-none pt-[9px] text-[15px]">
                  &gt;
                </span>
                <textarea
                  ref={textareaRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onInput={handleInput}
                  onKeyDown={handleKey}
                  placeholder="问问集群的情况…（Enter 发送 · Shift+Enter 换行 · @ 引用调查）"
                  rows={1}
                  className="flex-1 resize-none bg-transparent text-[16px] leading-[1.55]
                    text-[var(--color-text)] placeholder-[var(--color-text-dim)]
                    focus:outline-none py-2 min-h-[28px] max-h-[180px]"
                />
                <button
                  type="submit"
                  disabled={!input.trim()}
                  className="shrink-0 h-9 min-w-[72px] px-3 grid place-items-center rounded
                    bg-[var(--color-accent)] text-[var(--color-bg)]
                    hover:bg-[var(--color-accent-hover)]
                    disabled:bg-[var(--color-surface-3)] disabled:text-[var(--color-text-dim)]
                    disabled:cursor-not-allowed transition-colors
                    font-mono text-[11px] uppercase tracking-[0.15em]"
                  aria-label="发送"
                >
                  send
                </button>
              </div>
            </div>
          </div>
          <div className="mt-2 px-1 text-[12px] text-[var(--color-text-dim)] font-mono">
            回车创建新对话，Orca 会从只读工具开始排查
          </div>
        </form>

        {/* Cluster metrics (Lens 风格) */}
        <div className="orca-fade-in">
          <ClusterMetricsCards />
        </div>

        {/* Status + Investigations */}
        <div className="flex flex-col md:flex-row gap-6 orca-fade-in">
          <ClusterStatusCard />
          <PendingInvestigationsPanel />
        </div>
      </div>

      {/* @ 触发的 picker 用 fixed anchor 模式 */}
      {pickerOpen && pickerAnchor && (
        <InvestigationPicker
          open={pickerOpen}
          anchor={pickerAnchor}
          searchQuery={pickerQuery}
          onSearchQueryChange={setPickerQuery}
          excludeIds={referencedInvs.map((r) => r.id)}
          onPick={handlePick}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  )
}

function ClusterStatusCard() {
  const [status, setStatus] = useState<StatusResponse | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setInterval> | null = null
    const load = () => {
      getStatus()
        .then((s) => {
          if (!cancelled) {
            setStatus(s)
            setErr(null)
          }
        })
        .catch((e) => {
          if (!cancelled) setErr(e instanceof Error ? e.message : '加载失败')
        })
    }
    load()
    timer = setInterval(load, 30000)
    return () => {
      cancelled = true
      if (timer) clearInterval(timer)
    }
  }, [])

  const llmOk = !!status?.llm.configured
  const kubeOk = !!status?.kubernetes.connected

  return (
    <section className="md:w-1/3 min-w-[240px]">
      <div className="text-[11px] uppercase tracking-[0.22em] text-[var(--color-text-dim)] font-mono mb-2">
        cluster · 状态
      </div>
      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 space-y-2 font-mono text-[12px]">
        {err ? (
          <div className="text-[var(--color-danger)] text-[11.5px]">状态加载失败：{err}</div>
        ) : !status ? (
          <div className="text-[var(--color-text-dim)] text-[11.5px]">加载中…</div>
        ) : (
          <>
            <StatusLine
              label="LLM"
              ok={llmOk}
              detail={llmOk ? `${status.llm.provider} / ${status.llm.model}` : '未配置'}
            />
            <StatusLine
              label="K8s"
              ok={kubeOk}
              detail={
                kubeOk
                  ? `${status.kubernetes.mode} / ${status.kubernetes.server_version}`
                  : status.kubernetes.mode === 'unset'
                  ? '未配置'
                  : '未连接'
              }
            />
            <div className="pt-2 border-t border-[var(--color-border)] text-[11.5px] text-[var(--color-text-dim)]">
              {status.tools.length} 个工具就绪
            </div>
          </>
        )}
      </div>
    </section>
  )
}

function StatusLine({ label, ok, detail }: { label: string; ok: boolean; detail: string }) {
  return (
    <div className="flex items-center gap-2">
      <span
        className={`w-1.5 h-1.5 rounded-full shrink-0 ${
          ok
            ? 'bg-[var(--color-ok)] shadow-[0_0_5px_var(--color-ok)]'
            : 'bg-[var(--color-warn)]'
        }`}
      />
      <span className="text-[var(--color-text-muted)] w-8 shrink-0">[{label}]</span>
      <span className="text-[var(--color-text-dim)] truncate">{detail}</span>
    </div>
  )
}

function PendingInvestigationsPanel() {
  const [items, setItems] = useState<Investigation[] | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    listInvestigations({ view: 'active' })
      .then((list) => {
        if (!cancelled) {
          setItems(list.slice(0, LIMIT))
          setErr(null)
        }
      })
      .catch((e) => {
        if (!cancelled) setErr(e instanceof Error ? e.message : '加载失败')
      })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <section className="flex-1 min-w-0">
      <div className="flex items-center justify-between mb-2">
        <div className="text-[11px] uppercase tracking-[0.22em] text-[var(--color-text-dim)] font-mono">
          investigations · 待处理
        </div>
        <button
          type="button"
          onClick={() => navigate('/i')}
          className="text-[11px] font-mono text-[var(--color-accent)] hover:underline"
        >
          查看全部 →
        </button>
      </div>
      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]">
        {err ? (
          <div className="px-4 py-3 text-[11.5px] text-[var(--color-danger)] font-mono">
            加载失败：{err}
          </div>
        ) : !items ? (
          <div className="px-4 py-3 text-[11.5px] text-[var(--color-text-dim)] font-mono">
            加载中…
          </div>
        ) : items.length === 0 ? (
          <div className="px-4 py-6 text-center">
            <div className="font-semibold text-[18px] text-[var(--color-text-muted)] mb-1">
              一切安好
            </div>
            <div className="text-[11.5px] font-mono text-[var(--color-text-dim)]">
              暂无待处理调查 · all clear
            </div>
          </div>
        ) : (
          <ul className="divide-y divide-[var(--color-border)]">
            {items.map((inv) => (
              <li key={inv.id}>
                <button
                  type="button"
                  onClick={() => navigate(`/i/${inv.id}`)}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-left
                    hover:bg-[var(--color-surface-2)] transition-colors"
                >
                  <SeverityDot severity={inv.severity} />
                  <span className="flex-1 min-w-0 truncate text-[14px] text-[var(--color-text)]">
                    {inv.title || '未命名调查'}
                  </span>
                  <StatusBadge status={inv.status} />
                  <span className="text-[11px] font-mono text-[var(--color-text-dim)] tabular-nums shrink-0 w-14 text-right">
                    {formatRelativeTime(inv.updated_at)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
