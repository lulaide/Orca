import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import {
  getStatus,
  listInvestigations,
  type Investigation,
  type StatusResponse,
} from '../api'
import { navigate } from '../navigate'
import { SeverityDot, StatusBadge } from './investigationUI'
import { formatRelativeTime } from '../timeFormat'
import { ClusterMetricsCards } from './ClusterMetricsCards'

interface Props {
  onSubmit: (text: string) => void
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

export function HomePanel({ onSubmit, focusSignal }: Props) {
  const [input, setInput] = useState('')
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

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    const text = input.trim()
    if (!text) return
    setInput('')
    onSubmit(text)
  }

  const handleKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      const text = input.trim()
      if (!text) return
      setInput('')
      onSubmit(text)
    }
  }

  return (
    <div className="flex flex-col flex-1 min-h-0 h-full overflow-y-auto orca-grid">
      <div className="w-full max-w-4xl mx-auto px-8 pt-[8vh] pb-16 flex flex-col gap-10">
        {/* Greeting */}
        <div className="orca-fade-in">
          <div className="text-[11.5px] uppercase tracking-[0.25em] text-[var(--color-text-dim)] font-mono mb-3">
            {todayStr()}
          </div>
          <h1 className="font-serif-display text-[48px] leading-[1.02] text-[var(--color-text)] mb-2">
            {greeting()}
          </h1>
          <p className="text-[14px] text-[var(--color-text-muted)] max-w-md leading-relaxed">
            集群的眼睛·问一问，或先看看下面的状态摘要。
          </p>
        </div>

        {/* Prominent input */}
        <form onSubmit={handleSubmit} className="orca-fade-in">
          <div
            className="rounded-xl border border-[var(--color-border-strong)]
              bg-[var(--color-surface)]
              focus-within:border-[var(--color-text)]
              transition-colors shadow-sm"
          >
            <div className="flex items-start gap-3 px-4 py-3">
              <span className="font-mono text-[var(--color-accent)] select-none pt-[9px] text-[15px]">
                &gt;
              </span>
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKey}
                placeholder="问问集群的情况…（Enter 发送 · Shift+Enter 换行）"
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
            <div className="font-serif-display text-[18px] text-[var(--color-text-muted)] mb-1">
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
