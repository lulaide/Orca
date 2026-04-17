import { useEffect, useState } from 'react'
import {
  listConversations,
  deleteConversation,
  getStatus,
  listInvestigations,
  type Conversation,
  type Investigation,
  type StatusResponse,
} from '../api'
import { applyTheme, type Theme } from '../theme'
import { ConfirmDialog } from './ConfirmDialog'
import { navigate } from '../navigate'

type Route =
  | { kind: 'chat'; conversationId: string | null }
  | { kind: 'investigation'; id: string }
  | { kind: 'investigation-list'; view: string }

interface Props {
  activeId: string | null
  onSelect: (id: string | null) => void
  refreshToken: number
  route?: Route
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  if (sameDay) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }
  const diffDays = Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24))
  if (diffDays === 1) return '昨天'
  if (diffDays < 7) return `${diffDays} 天前`
  return d.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })
}

function currentTheme(): Theme {
  return (document.documentElement.getAttribute('data-theme') as Theme) || 'light'
}

export function Sidebar({ activeId, onSelect, refreshToken, route }: Props) {
  const [convs, setConvs] = useState<Conversation[]>([])
  const [invs, setInvs] = useState<Investigation[]>([])
  const [status, setStatus] = useState<StatusResponse | null>(null)
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [theme, setTheme] = useState<Theme>(currentTheme())
  const [pendingDelete, setPendingDelete] = useState<Conversation | null>(null)

  useEffect(() => {
    listConversations().then(setConvs).catch(console.error)
    listInvestigations({ view: 'active' })
      .then((list) => setInvs(list.slice(0, 5)))
      .catch(console.error)
  }, [refreshToken])

  const activeInvId = route?.kind === 'investigation' ? route.id : null
  const onInvListRoute = route?.kind === 'investigation-list'

  useEffect(() => {
    const load = () => getStatus().then(setStatus).catch(() => {})
    load()
    const t = setInterval(load, 30000)
    return () => clearInterval(t)
  }, [])

  const openDelete = (e: React.MouseEvent, conv: Conversation) => {
    e.stopPropagation()
    setPendingDelete(conv)
  }

  const confirmDelete = async () => {
    if (!pendingDelete) return
    const id = pendingDelete.id
    setPendingDelete(null)
    try {
      await deleteConversation(id)
      setConvs((prev) => prev.filter((c) => c.id !== id))
      if (activeId === id) onSelect(null)
    } catch (err) {
      console.error(err)
    }
  }

  const toggleTheme = () => {
    const next: Theme = theme === 'light' ? 'dark' : 'light'
    applyTheme(next)
    setTheme(next)
  }

  const llmOk = !!status?.llm.configured
  const kubeOk = !!status?.kubernetes.connected

  return (
    <>
    <ConfirmDialog
      open={!!pendingDelete}
      tag="rm"
      danger
      title="删除此对话？"
      description="会永久移除对话记录与全部消息，无法恢复。"
      subject={pendingDelete?.title || '未命名'}
      confirmLabel="删除"
      onConfirm={confirmDelete}
      onCancel={() => setPendingDelete(null)}
    />
    <aside className="w-72 shrink-0 flex flex-col h-full bg-[var(--color-surface)] border-r border-[var(--color-border)]">
      {/* Brand */}
      <div className="px-5 pt-6 pb-4">
        <div className="flex items-baseline gap-2 mb-1">
          <span className="font-serif-display text-[28px] leading-none text-[var(--color-text)]">
            orca
          </span>
          <WaveMark className="w-5 h-2 text-[var(--color-accent)]" />
        </div>
        <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--color-text-dim)] font-mono">
          sre · operations desk
        </div>
      </div>

      {/* New chat */}
      <div className="px-4 pb-3">
        <button
          type="button"
          onClick={() => onSelect(null)}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-md
            border border-[var(--color-border-strong)]
            bg-[var(--color-bg)] hover:bg-[var(--color-accent-soft)]
            hover:border-[var(--color-accent)]
            text-[13px] text-[var(--color-text)] transition-colors"
        >
          <span className="text-[var(--color-accent)] font-mono leading-none">+</span>
          <span>新对话</span>
          <span className="ml-auto text-[11px] text-[var(--color-text-dim)] font-mono">new</span>
        </button>
      </div>

      {/* Investigations section */}
      <div className="px-2 pb-2 border-b border-[var(--color-border)]">
        <div className="flex items-center justify-between px-3 py-1.5">
          <span className="text-[11.5px] uppercase tracking-[0.2em] text-[var(--color-text-dim)] font-mono">
            调查 · investigations
          </span>
          <button
            type="button"
            onClick={() => navigate('/i')}
            className={`text-[11.5px] font-mono transition-colors
              ${onInvListRoute ? 'text-[var(--color-accent)]' : 'text-[var(--color-text-dim)] hover:text-[var(--color-text-muted)]'}`}
          >
            查看全部 →
          </button>
        </div>
        {invs.length === 0 ? (
          <div className="px-3 py-1.5 text-[11.5px] text-[var(--color-text-dim)] italic">
            暂无进行中
          </div>
        ) : (
          invs.map((iv) => {
            const active = iv.id === activeInvId
            return (
              <button
                key={iv.id}
                type="button"
                onClick={() => navigate(`/i/${iv.id}`)}
                className={`group w-full relative flex items-center gap-2 pl-4 pr-2 py-[6px] rounded-md
                  text-left text-[12.5px] transition-colors
                  ${active
                    ? 'bg-[var(--color-bg)] text-[var(--color-text)]'
                    : 'text-[var(--color-text-muted)] hover:bg-[var(--color-bg)] hover:text-[var(--color-text)]'}`}
              >
                {active && (
                  <span className="absolute left-1 top-1/2 -translate-y-1/2 w-[2px] h-4 bg-[var(--color-accent)]" />
                )}
                <span
                  className="shrink-0 w-1.5 h-1.5 rounded-full"
                  style={{
                    backgroundColor:
                      iv.severity === 'critical'
                        ? 'var(--color-danger)'
                        : iv.severity === 'warning'
                        ? 'var(--color-warn)'
                        : 'var(--color-text-dim)',
                  }}
                />
                <span className="flex-1 truncate">{iv.title}</span>
              </button>
            )
          })
        )}
      </div>

      {/* Conversation list */}
      <div className="flex-1 overflow-y-auto px-2 pb-2">
        <div className="px-3 py-1.5 text-[11.5px] uppercase tracking-[0.2em] text-[var(--color-text-dim)] font-mono">
          最近
        </div>
        {convs.length === 0 && (
          <div className="px-3 py-3 text-xs text-[var(--color-text-dim)] italic">
            还没有对话。
          </div>
        )}
        {convs.map((c) => {
          const active = c.id === activeId
          const isHovered = hoveredId === c.id
          return (
            <div
              key={c.id}
              onMouseEnter={() => setHoveredId(c.id)}
              onMouseLeave={() => setHoveredId(null)}
              onClick={() => onSelect(c.id)}
              className={`group relative flex items-center gap-2 pl-4 pr-2 py-[7px] rounded-md cursor-pointer
                text-[13px] transition-colors
                ${active
                  ? 'bg-[var(--color-bg)] text-[var(--color-text)]'
                  : 'text-[var(--color-text-muted)] hover:bg-[var(--color-bg)] hover:text-[var(--color-text)]'}`}
            >
              {active && (
                <span className="absolute left-1 top-1/2 -translate-y-1/2 w-[2px] h-4 bg-[var(--color-accent)]" />
              )}
              <span className="flex-1 truncate">
                {c.title || <span className="italic text-[var(--color-text-dim)]">未命名</span>}
              </span>
              {isHovered ? (
                <button
                  type="button"
                  onClick={(e) => openDelete(e, c)}
                  className="shrink-0 w-5 h-5 grid place-items-center rounded text-[var(--color-text-dim)] hover:text-[var(--color-danger)]"
                  aria-label="删除"
                >
                  <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" strokeLinecap="round" />
                  </svg>
                </button>
              ) : (
                <span className="shrink-0 text-[11.5px] text-[var(--color-text-dim)] font-mono tabular-nums">
                  {formatTime(c.updated_at)}
                </span>
              )}
            </div>
          )
        })}
      </div>

      {/* Status + theme toggle */}
      <div className="border-t border-[var(--color-border)] px-4 py-3 space-y-1.5 text-[11px] font-mono">
        <StatusRow
          label="LLM"
          ok={llmOk}
          detail={llmOk ? `${status!.llm.provider} / ${status!.llm.model}` : '未配置'}
        />
        <StatusRow
          label="K8s"
          ok={kubeOk}
          detail={
            kubeOk
              ? `${status!.kubernetes.mode} / ${status!.kubernetes.server_version}`
              : status?.kubernetes.mode === 'unset'
              ? '未配置'
              : '未连接'
          }
        />
        <div className="flex items-center justify-between pt-2 border-t border-[var(--color-border)] mt-2">
          {status?.tools && (
            <span className="text-[var(--color-text-dim)]">
              {status.tools.length} 个工具就绪
            </span>
          )}
          <button
            type="button"
            onClick={toggleTheme}
            className="ml-auto flex items-center gap-1.5 px-2 py-1 rounded
              text-[var(--color-text-muted)] hover:text-[var(--color-text)]
              hover:bg-[var(--color-surface-2)] transition-colors"
            aria-label="切换主题"
          >
            {theme === 'light' ? (
              <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="4" />
                <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
              </svg>
            )}
            <span>{theme === 'light' ? '暗' : '明'}</span>
          </button>
        </div>
      </div>
    </aside>
    </>
  )
}

function StatusRow({ label, ok, detail }: { label: string; ok: boolean; detail: string }) {
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

// 小波浪标志 — 替代渐变方块 logo
function WaveMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 8" className={className} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
      <path d="M1 4 Q 6 1, 11 4 T 21 4 T 31 4 T 39 4" />
    </svg>
  )
}
