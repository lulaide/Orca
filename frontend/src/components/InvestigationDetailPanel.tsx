import { useEffect, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  archiveInvestigation,
  createInvestigationEntry,
  getInvestigation,
  listInvestigationEntries,
  unarchiveInvestigation,
  updateInvestigation,
  type Investigation,
  type InvestigationEntry,
  type InvestigationEntryType,
  type InvestigationStatus,
} from '../api'
import { navigate } from '../navigate'
import { ConfirmDialog } from './ConfirmDialog'
import { SeverityDot, StatusBadge } from './investigationUI'
import { formatRelativeTime } from '../timeFormat'

interface Props {
  id: string
  onChanged: () => void
}

export function InvestigationDetailPanel({ id, onChanged }: Props) {
  const [inv, setInv] = useState<Investigation | null>(null)
  const [entries, setEntries] = useState<InvestigationEntry[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [askArchive, setAskArchive] = useState(false)
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState('')
  const [editingDesc, setEditingDesc] = useState(false)
  const [descDraft, setDescDraft] = useState('')
  const [askResolve, setAskResolve] = useState(false)
  const [rootCause, setRootCause] = useState('')
  const [solution, setSolution] = useState('')
  const [showAddEntry, setShowAddEntry] = useState(false)
  const [entryType, setEntryType] = useState<InvestigationEntryType>('note')
  const [entryContent, setEntryContent] = useState('')

  const reload = async () => {
    try {
      const [i, e] = await Promise.all([getInvestigation(id), listInvestigationEntries(id)])
      setInv(i)
      setEntries(e)
      setErr(null)
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : '加载失败')
    }
  }

  useEffect(() => {
    setInv(null)
    setEntries([])
    setErr(null)
    void reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  if (err) {
    return (
      <div className="flex flex-col flex-1 min-h-0 h-full items-center justify-center">
        <div className="text-[13px] font-mono text-[var(--color-danger)]">{err}</div>
        <button
          onClick={() => navigate('/i')}
          className="mt-4 text-[12px] text-[var(--color-text-dim)] underline"
        >
          回到列表
        </button>
      </div>
    )
  }
  if (!inv) {
    return (
      <div className="flex flex-col flex-1 min-h-0 h-full items-center justify-center">
        <div className="text-[12.5px] text-[var(--color-text-dim)] italic">加载中…</div>
      </div>
    )
  }

  const archived = !!inv.archived_at
  const resolved = inv.status === 'resolved'

  const saveTitle = async () => {
    const t = titleDraft.trim()
    setEditingTitle(false)
    if (!t || t === inv.title) return
    setBusy(true)
    try {
      const next = await updateInvestigation(id, { title: t })
      setInv(next)
      onChanged()
    } catch (e) {
      setErr(e instanceof Error ? e.message : '保存失败')
    } finally {
      setBusy(false)
    }
  }
  const saveDesc = async () => {
    setEditingDesc(false)
    if (descDraft === (inv.description || '')) return
    setBusy(true)
    try {
      const next = await updateInvestigation(id, { description: descDraft })
      setInv(next)
      onChanged()
    } catch (e) {
      setErr(e instanceof Error ? e.message : '保存失败')
    } finally {
      setBusy(false)
    }
  }
  const cycleStatus = async () => {
    if (archived) return
    const order: InvestigationStatus[] = ['open', 'investigating', 'resolved', 'stale']
    const cur = order.indexOf(inv.status)
    const next = order[(cur + 1) % order.length]
    if (next === 'resolved') {
      setRootCause(inv.root_cause || '')
      setSolution(inv.solution || '')
      setAskResolve(true)
      return
    }
    setBusy(true)
    try {
      const u = await updateInvestigation(id, { status: next })
      setInv(u)
      onChanged()
    } catch (e) {
      setErr(e instanceof Error ? e.message : '更新状态失败')
    } finally {
      setBusy(false)
    }
  }
  const confirmResolve = async () => {
    setAskResolve(false)
    setBusy(true)
    try {
      const u = await updateInvestigation(id, {
        status: 'resolved',
        root_cause: rootCause,
        solution,
      })
      setInv(u)
      await reload()
      onChanged()
    } catch (e) {
      setErr(e instanceof Error ? e.message : '保存失败')
    } finally {
      setBusy(false)
    }
  }
  const confirmArchive = async () => {
    setAskArchive(false)
    setBusy(true)
    try {
      const u = await archiveInvestigation(id)
      setInv(u)
      onChanged()
    } catch (e) {
      setErr(e instanceof Error ? e.message : '归档失败')
    } finally {
      setBusy(false)
    }
  }
  const doUnarchive = async () => {
    setBusy(true)
    try {
      const u = await unarchiveInvestigation(id)
      setInv(u)
      onChanged()
    } catch (e) {
      setErr(e instanceof Error ? e.message : '取消归档失败')
    } finally {
      setBusy(false)
    }
  }
  const submitEntry = async () => {
    const content = entryContent.trim()
    if (!content) return
    setBusy(true)
    try {
      await createInvestigationEntry(id, { type: entryType, content })
      setShowAddEntry(false)
      setEntryContent('')
      setEntryType('note')
      await reload()
      onChanged()
    } catch (e) {
      setErr(e instanceof Error ? e.message : '追加失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={`flex flex-col flex-1 min-h-0 h-full ${archived ? 'opacity-80' : ''}`}>
      <ConfirmDialog
        open={askArchive}
        tag="archive"
        title="归档此调查？"
        description="归档后将从“进行中”列表隐藏，可在“已归档”视图找回。对话历史中的引用仍可查阅，编辑能力会被锁定。"
        subject={inv.title}
        confirmLabel="归档"
        onConfirm={confirmArchive}
        onCancel={() => setAskArchive(false)}
      />

      {/* Header */}
      <header className="flex items-center justify-between px-6 h-11 border-b border-[var(--color-border)] bg-[var(--color-bg)] font-mono text-[11px]">
        <div className="flex items-center gap-2 text-[var(--color-text-dim)] min-w-0">
          <span className="text-[var(--color-accent)]">~</span>
          <span>/</span>
          <span>orca</span>
          <span>/</span>
          <button onClick={() => navigate('/i')} className="hover:text-[var(--color-text-muted)] transition-colors">
            investigations
          </button>
          <span>/</span>
          <span className="text-[var(--color-text-muted)] truncate">{id.slice(0, 6)}</span>
        </div>
        <span className="text-[var(--color-text-dim)] tabular-nums">
          {entries.length} entries
        </span>
      </header>

      <div className="flex-1 overflow-y-auto orca-grid">
        <div className="max-w-3xl mx-auto px-6 py-6">
          {archived && (
            <div className="mb-5 px-4 py-2.5 rounded border border-[var(--color-border-strong)] bg-[var(--color-surface)] flex items-center gap-3">
              <span className="text-[11px] font-mono uppercase tracking-[0.2em] text-[var(--color-text-dim)] border border-[var(--color-border)] px-1.5 py-0.5 rounded">
                archived
              </span>
              <span className="text-[12.5px] text-[var(--color-text-muted)] flex-1">
                此调查已于 {formatRelativeTime(inv.archived_at!)} 归档，内容只读。
              </span>
              <button
                type="button"
                disabled={busy}
                onClick={doUnarchive}
                className="px-2.5 h-7 rounded bg-[var(--color-accent)] text-[var(--color-bg)]
                  hover:bg-[var(--color-accent-hover)]
                  disabled:opacity-50
                  font-mono text-[12px] uppercase tracking-[0.15em] transition-colors"
              >
                取消归档
              </button>
            </div>
          )}

          {/* Title */}
          <div className="mb-3 flex items-start gap-3">
            <SeverityDot severity={inv.severity} />
            <div className="flex-1 min-w-0">
              {editingTitle && !archived ? (
                <input
                  autoFocus
                  value={titleDraft}
                  onChange={(e) => setTitleDraft(e.target.value)}
                  onBlur={saveTitle}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') saveTitle()
                    if (e.key === 'Escape') setEditingTitle(false)
                  }}
                  className="w-full font-serif-display text-[32px] leading-tight text-[var(--color-text)]
                    bg-transparent border-b border-[var(--color-border)]
                    focus:border-[var(--color-text)] focus:outline-none pb-1"
                />
              ) : (
                <h1
                  className={`font-serif-display text-[32px] leading-tight text-[var(--color-text)]
                    ${archived ? 'line-through decoration-[var(--color-text-dim)]' : 'cursor-text hover:bg-[var(--color-surface)]'}`}
                  onClick={() => {
                    if (archived) return
                    setTitleDraft(inv.title)
                    setEditingTitle(true)
                  }}
                  title={archived ? '已归档' : '点击编辑'}
                >
                  {inv.title}
                </h1>
              )}
            </div>
          </div>

          {/* Meta */}
          <div className="flex items-center gap-3 mb-5 flex-wrap">
            <button
              type="button"
              onClick={cycleStatus}
              disabled={archived || busy}
              title={archived ? '已归档不可变' : '点击切换状态'}
              className={`${archived ? 'cursor-not-allowed' : 'hover:brightness-110 cursor-pointer'}`}
            >
              <StatusBadge status={inv.status} />
            </button>
            <span className="text-[11px] font-mono text-[var(--color-text-dim)]">
              severity={inv.severity}
            </span>
            {inv.source && (
              <span className="text-[11px] font-mono text-[var(--color-text-dim)]">
                source={inv.source}
              </span>
            )}
            {inv.resolved_at && (
              <span className="text-[11px] font-mono text-[var(--color-text-dim)]">
                resolved {formatRelativeTime(inv.resolved_at)}
              </span>
            )}
            {inv.related_services && inv.related_services.length > 0 && (
              <div className="flex items-center gap-1.5 flex-wrap">
                {inv.related_services.map((s) => (
                  <span
                    key={s}
                    className="text-[12px] font-mono px-1.5 py-0.5 rounded bg-[var(--color-surface-2)] text-[var(--color-text-muted)]"
                  >
                    {s}
                  </span>
                ))}
              </div>
            )}
            {!archived && (
              <button
                type="button"
                onClick={() => setAskArchive(true)}
                disabled={busy}
                className="ml-auto px-2.5 h-7 rounded border border-[var(--color-border-strong)]
                  hover:bg-[var(--color-surface-2)] text-[var(--color-text-muted)]
                  disabled:opacity-50
                  font-mono text-[12px] uppercase tracking-[0.15em] transition-colors"
              >
                归档
              </button>
            )}
          </div>

          {/* Description */}
          <section className="mb-6">
            <div className="text-[11.5px] uppercase tracking-[0.2em] text-[var(--color-text-dim)] font-mono mb-2">
              描述
            </div>
            {editingDesc && !archived ? (
              <div>
                <textarea
                  autoFocus
                  value={descDraft}
                  onChange={(e) => setDescDraft(e.target.value)}
                  rows={5}
                  className="w-full px-3 py-2 rounded border border-[var(--color-border-strong)]
                    bg-[var(--color-bg)] text-[14px] text-[var(--color-text)] leading-relaxed
                    focus:border-[var(--color-text)] focus:outline-none transition-colors"
                />
                <div className="mt-1.5 flex gap-2 justify-end">
                  <button
                    onClick={() => setEditingDesc(false)}
                    className="px-2.5 h-7 rounded border border-[var(--color-border-strong)] text-[var(--color-text)]
                      font-mono text-[12px] uppercase tracking-[0.15em]"
                  >
                    取消
                  </button>
                  <button
                    onClick={saveDesc}
                    disabled={busy}
                    className="px-2.5 h-7 rounded bg-[var(--color-accent)] text-[var(--color-bg)]
                      font-mono text-[12px] uppercase tracking-[0.15em]"
                  >
                    保存
                  </button>
                </div>
              </div>
            ) : (
              <div
                className={`orca-prose ${archived ? '' : 'cursor-text hover:bg-[var(--color-surface)] rounded px-2 -mx-2'}`}
                onClick={() => {
                  if (archived) return
                  setDescDraft(inv.description || '')
                  setEditingDesc(true)
                }}
              >
                {inv.description ? (
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{inv.description}</ReactMarkdown>
                ) : (
                  <p className="text-[13px] text-[var(--color-text-dim)] italic">（无描述，点击添加）</p>
                )}
              </div>
            )}
          </section>

          {/* Resolution (when resolved) */}
          {resolved && (inv.root_cause || inv.solution) && (
            <section className="mb-6 rounded border border-[var(--color-ok)]/40 bg-[var(--color-ok)]/5 px-4 py-3">
              <div className="text-[11.5px] uppercase tracking-[0.2em] text-[var(--color-ok)] font-mono mb-2">
                已解决
              </div>
              {inv.root_cause && (
                <div className="mb-2">
                  <div className="text-[11px] text-[var(--color-text-dim)] font-mono mb-1">root cause</div>
                  <div className="orca-prose">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{inv.root_cause}</ReactMarkdown>
                  </div>
                </div>
              )}
              {inv.solution && (
                <div>
                  <div className="text-[11px] text-[var(--color-text-dim)] font-mono mb-1">solution</div>
                  <div className="orca-prose">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{inv.solution}</ReactMarkdown>
                  </div>
                </div>
              )}
            </section>
          )}

          {/* Timeline */}
          <section className="mb-6">
            <div className="flex items-center justify-between mb-3">
              <div className="text-[11.5px] uppercase tracking-[0.2em] text-[var(--color-text-dim)] font-mono">
                时间线 · timeline
              </div>
              {!archived && (
                <button
                  onClick={() => setShowAddEntry(true)}
                  className="text-[11px] font-mono text-[var(--color-accent)] hover:text-[var(--color-accent-hover)]"
                >
                  + 追加
                </button>
              )}
            </div>
            {entries.length === 0 ? (
              <div className="text-[12.5px] text-[var(--color-text-dim)] italic">还没有条目。</div>
            ) : (
              <div className="space-y-4 border-l border-[var(--color-border)] pl-5 ml-1">
                {entries.map((e) => (
                  <TimelineEntry key={e.id} entry={e} />
                ))}
              </div>
            )}

            {showAddEntry && !archived && (
              <div className="mt-4 rounded border border-[var(--color-border-strong)] bg-[var(--color-surface)] p-3">
                <div className="flex items-center gap-2 mb-2">
                  <select
                    value={entryType}
                    onChange={(e) => setEntryType(e.target.value as InvestigationEntryType)}
                    className="px-2 h-7 rounded border border-[var(--color-border-strong)]
                      bg-[var(--color-bg)] text-[11.5px] font-mono text-[var(--color-text)]
                      focus:border-[var(--color-text)] focus:outline-none"
                  >
                    <option value="note">note</option>
                    <option value="discovery">discovery</option>
                    <option value="action">action</option>
                  </select>
                  <span className="text-[12px] text-[var(--color-text-dim)] font-mono">
                    作为 user 追加
                  </span>
                </div>
                <textarea
                  value={entryContent}
                  onChange={(e) => setEntryContent(e.target.value)}
                  placeholder="内容（markdown）"
                  rows={4}
                  className="w-full px-3 py-2 rounded border border-[var(--color-border)]
                    bg-[var(--color-bg)] text-[13px] text-[var(--color-text)] leading-relaxed
                    focus:border-[var(--color-text)] focus:outline-none transition-colors"
                />
                <div className="mt-2 flex gap-2 justify-end">
                  <button
                    onClick={() => {
                      setShowAddEntry(false)
                      setEntryContent('')
                    }}
                    className="px-2.5 h-7 rounded border border-[var(--color-border-strong)] text-[var(--color-text)]
                      font-mono text-[12px] uppercase tracking-[0.15em]"
                  >
                    取消
                  </button>
                  <button
                    onClick={submitEntry}
                    disabled={busy || !entryContent.trim()}
                    className="px-2.5 h-7 rounded bg-[var(--color-accent)] text-[var(--color-bg)]
                      disabled:opacity-50
                      font-mono text-[12px] uppercase tracking-[0.15em]"
                  >
                    追加
                  </button>
                </div>
              </div>
            )}
          </section>

          {/* Resolve dialog (overlay-style) */}
          {askResolve && (
            <div
              className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-black/40 backdrop-blur-[1px] orca-fade-in"
              onClick={() => setAskResolve(false)}
              role="dialog"
              aria-modal="true"
            >
              <div
                onClick={(e) => e.stopPropagation()}
                className="w-full max-w-lg rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)] shadow-2xl overflow-hidden"
              >
                <div className="flex items-center justify-between px-5 h-9 border-b border-[var(--color-border)] bg-[var(--color-bg)]">
                  <div className="flex items-center gap-2 font-mono text-[12px] uppercase tracking-[0.22em]">
                    <span className="text-[var(--color-ok)]">resolve</span>
                    <span className="text-[var(--color-text-dim)] opacity-60">/</span>
                    <span className="text-[var(--color-text-dim)]">结单</span>
                  </div>
                </div>
                <div className="px-5 pt-4 pb-4 space-y-3">
                  <div>
                    <label className="block text-[11.5px] uppercase tracking-[0.2em] text-[var(--color-text-dim)] font-mono mb-1.5">
                      根因 root cause
                    </label>
                    <textarea
                      value={rootCause}
                      onChange={(e) => setRootCause(e.target.value)}
                      rows={3}
                      className="w-full px-3 py-2 rounded border border-[var(--color-border-strong)]
                        bg-[var(--color-bg)] text-[13px] text-[var(--color-text)] leading-relaxed
                        focus:border-[var(--color-text)] focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[11.5px] uppercase tracking-[0.2em] text-[var(--color-text-dim)] font-mono mb-1.5">
                      解决方案 solution
                    </label>
                    <textarea
                      value={solution}
                      onChange={(e) => setSolution(e.target.value)}
                      rows={3}
                      className="w-full px-3 py-2 rounded border border-[var(--color-border-strong)]
                        bg-[var(--color-bg)] text-[13px] text-[var(--color-text)] leading-relaxed
                        focus:border-[var(--color-text)] focus:outline-none"
                    />
                  </div>
                </div>
                <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-[var(--color-border)] bg-[var(--color-bg)]">
                  <button
                    onClick={() => setAskResolve(false)}
                    className="px-3 h-8 rounded border border-[var(--color-border-strong)] text-[var(--color-text)]
                      font-mono text-[11px] uppercase tracking-[0.15em]"
                  >
                    取消
                  </button>
                  <button
                    onClick={confirmResolve}
                    disabled={busy}
                    className="px-3 h-8 rounded bg-[var(--color-accent)] text-[var(--color-bg)]
                      font-mono text-[11px] uppercase tracking-[0.15em]"
                  >
                    确认结单
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function TimelineEntry({ entry }: { entry: InvestigationEntry }) {
  const typeColor: Record<InvestigationEntryType, string> = {
    discovery: 'var(--color-accent)',
    action: 'var(--color-warn)',
    resolution: 'var(--color-ok)',
    note: 'var(--color-text-dim)',
  }
  return (
    <div className="relative">
      <span
        className="absolute -left-[27px] top-[7px] w-2.5 h-2.5 rounded-full border-2 border-[var(--color-bg)]"
        style={{ backgroundColor: typeColor[entry.type] }}
      />
      <div className="flex items-center gap-2 mb-1 text-[11px] font-mono text-[var(--color-text-dim)]">
        <span style={{ color: typeColor[entry.type] }} className="uppercase tracking-[0.18em]">
          {entry.type}
        </span>
        <span>·</span>
        <span>{entry.author}</span>
        <span>·</span>
        <span className="tabular-nums">{formatRelativeTime(entry.created_at)}</span>
      </div>
      <div className="orca-prose text-[13.5px]">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{entry.content}</ReactMarkdown>
      </div>
    </div>
  )
}
