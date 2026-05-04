import { useEffect, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  approveInvestigation,
  archiveInvestigation,
  createInvestigationEntry,
  getInvestigation,
  listInvestigationEntries,
  rejectInvestigation,
  unarchiveInvestigation,
  updateInvestigation,
  type Investigation,
  type InvestigationEntry,
  type InvestigationEntryType,
  type InvestigationStatus,
} from '../api'
import { navigate } from '../navigate'
import { ConfirmDialog } from './ConfirmDialog'
import { InvestigationChatDrawer } from './InvestigationChatDrawer'
import { SeverityDot, SeverityBadge, StatusBadge } from './investigationUI'
import { formatRelativeTime } from '../timeFormat'

const DRAWER_LS_KEY = 'orca.inv.drawer.open'

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
  const [showReject, setShowReject] = useState(false)
  const [rejectFeedback, setRejectFeedback] = useState('')
  const [drawerOpen, setDrawerOpen] = useState<boolean>(() => {
    try {
      return localStorage.getItem(DRAWER_LS_KEY) === '1'
    } catch {
      return false
    }
  })
  const toggleDrawer = () => {
    setDrawerOpen((o) => {
      const next = !o
      try {
        localStorage.setItem(DRAWER_LS_KEY, next ? '1' : '0')
      } catch {
        // ignore
      }
      return next
    })
  }

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

  // 流水线状态时自动轮询刷新（5s）
  useEffect(() => {
    if (!inv) return
    const pipelineStatuses = ['exploring', 'explored', 'generating', 'evaluating', 'executing', 'verifying']
    if (!pipelineStatuses.includes(inv.status)) return
    const timer = setInterval(() => void reload(), 5000)
    return () => clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inv?.status, id])

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

  const doApprove = async () => {
    setBusy(true)
    try {
      const u = await approveInvestigation(id)
      setInv(u)
      await reload()
      onChanged()
    } catch (e) {
      setErr(e instanceof Error ? e.message : '确认失败')
    } finally {
      setBusy(false)
    }
  }

  const doReject = async () => {
    setBusy(true)
    try {
      const u = await rejectInvestigation(id, rejectFeedback)
      setInv(u)
      setShowReject(false)
      setRejectFeedback('')
      await reload()
      onChanged()
    } catch (e) {
      setErr(e instanceof Error ? e.message : '拒绝失败')
    } finally {
      setBusy(false)
    }
  }

  const isPipelineStatus = ['exploring', 'explored', 'generating', 'evaluating', 'awaiting_approval', 'executing', 'verifying'].includes(inv.status)

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
      <header className="flex items-center justify-between px-4 md:px-6 h-12 border-b border-[var(--color-border)] bg-[var(--color-bg)]">
        <div className="flex items-center">
          <button type="button" onClick={() => navigate('/i')}
            className="md:hidden mr-2 text-[var(--color-accent)]">
            <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M15 18l-6-6 6-6" /></svg>
          </button>
          <span className="text-[14px] font-medium text-[var(--color-text)]">调查详情</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[var(--color-text-dim)] tabular-nums">
            {entries.length} 条记录
          </span>
          <button
            type="button"
            onClick={toggleDrawer}
            className={`flex items-center gap-1.5 px-2 h-7 rounded border
              text-[11px] font-medium transition-colors
              ${
                drawerOpen
                  ? 'border-[var(--color-accent)] text-[var(--color-accent)] bg-[var(--color-accent-soft)]'
                  : 'border-[var(--color-border-strong)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-2)]'
              }`}
            aria-label={drawerOpen ? '关闭抽屉' : '打开抽屉'}
          >
            <span>✦</span>
            <span>{drawerOpen ? '关闭' : '提问'}</span>
          </button>
        </div>
      </header>

      <div className="flex flex-1 min-h-0">
        <div className="flex-1 overflow-y-auto orca-grid min-w-0">
          <div className="max-w-3xl mx-auto px-6 py-6">
          {archived && (
            <div className="mb-5 px-4 py-2.5 rounded border border-[var(--color-border-strong)] bg-[var(--color-surface)] flex items-center gap-3">
              <span className="text-[11px] font-medium text-[var(--color-text-dim)] bg-[var(--color-surface-2)] px-2 py-0.5 rounded-full">
                已归档
              </span>
              <span className="text-[12.5px] text-[var(--color-text-muted)] flex-1">
                此调查已于 {formatRelativeTime(inv.archived_at!)} 归档，内容只读。
              </span>
              <button
                type="button"
                disabled={busy}
                onClick={doUnarchive}
                className="px-3 h-7 rounded bg-[var(--color-accent)] text-white
                  hover:bg-[var(--color-accent-hover)]
                  disabled:opacity-50 text-[12px] transition-colors"
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
                  className="w-full font-semibold text-[18px] md:text-[24px] leading-tight text-[var(--color-text)]
                    bg-transparent border-b-2 border-[var(--color-accent)]
                    focus:outline-none pb-1"
                />
              ) : (
                <div className="group flex items-start gap-2">
                  <h1 className={`font-semibold text-[18px] md:text-[24px] leading-tight text-[var(--color-text)]
                    ${archived ? 'line-through decoration-[var(--color-text-dim)]' : ''}`}>
                    {inv.title}
                  </h1>
                  {!archived && (
                    <button
                      type="button"
                      onClick={() => { setTitleDraft(inv.title); setEditingTitle(true) }}
                      className="shrink-0 mt-1 w-6 h-6 grid place-items-center rounded
                        text-[var(--color-text-dim)] opacity-0 group-hover:opacity-100
                        hover:text-[var(--color-accent)] hover:bg-[var(--color-surface-2)]
                        transition-all"
                      title="编辑标题"
                    >
                      <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M17 3a2.83 2.83 0 114 4L7.5 20.5 2 22l1.5-5.5z" /></svg>
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Meta */}
          <div className="flex items-center gap-2 md:gap-3 mb-4 md:mb-5 overflow-x-auto md:flex-wrap">
            {archived || isPipelineStatus ? (
              <StatusBadge status={inv.status} />
            ) : (
              <div className="relative">
                <select
                  value={inv.status}
                  onChange={async (e) => {
                    const next = e.target.value as InvestigationStatus
                    if (next === inv.status) return
                    if (next === 'resolved') {
                      setRootCause(inv.root_cause || '')
                      setSolution(inv.solution || '')
                      setAskResolve(true)
                      return
                    }
                    setBusy(true)
                    try {
                      const u = await updateInvestigation(id, { status: next })
                      setInv(u); onChanged()
                    } catch (ex) { setErr(ex instanceof Error ? ex.message : '更新失败') }
                    finally { setBusy(false) }
                  }}
                  disabled={busy}
                  className="appearance-none text-[13px] font-medium pl-3 pr-8 py-1.5 rounded-lg border cursor-pointer
                    bg-[var(--color-surface)] text-[var(--color-text)] border-[var(--color-border-strong)]
                    hover:bg-[var(--color-surface-2)] hover:border-[var(--color-accent)]
                    focus:outline-none focus:border-[var(--color-accent)]
                    disabled:opacity-50 transition-all"
                >
                  <option value="open">待处理</option>
                  <option value="investigating">排查中</option>
                  <option value="resolved">已解决</option>
                </select>
                <span className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-[10px] text-[var(--color-text-dim)]">▾</span>
              </div>
            )}
            <SeverityBadge severity={inv.severity} />
            {inv.source && (
              <span className="text-[12px] text-[var(--color-text-dim)]">
                来源：{inv.source}
              </span>
            )}
            {inv.resolved_at && (
              <span className="text-[12px] text-[var(--color-text-dim)]">
                {formatRelativeTime(inv.resolved_at)}解决
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
                className="ml-auto orca-btn-secondary"
              >
                归档
              </button>
            )}
          </div>

          {/* Description */}
          <section className="mb-6">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[17px] font-semibold text-[var(--color-text)]">描述</span>
              {!archived && !editingDesc && (
                <button
                  type="button"
                  onClick={() => { setDescDraft(inv.description || ''); setEditingDesc(true) }}
                  className="orca-btn-link text-[12px]"
                >
                  编辑
                </button>
              )}
            </div>
            {editingDesc && !archived ? (
              <div>
                <textarea
                  autoFocus
                  value={descDraft}
                  onChange={(e) => setDescDraft(e.target.value)}
                  rows={5}
                  className="w-full px-3 py-2 rounded-lg border border-[var(--color-border-strong)]
                    bg-[var(--color-bg)] text-[14px] text-[var(--color-text)] leading-relaxed
                    focus:border-[var(--color-accent)] focus:outline-none transition-colors"
                />
                <div className="mt-2 flex gap-2 justify-end">
                  <button onClick={() => setEditingDesc(false)} className="orca-btn-secondary">
                    取消
                  </button>
                  <button onClick={saveDesc} disabled={busy} className="orca-btn-primary">
                    保存
                  </button>
                </div>
              </div>
            ) : (
              <div className="orca-prose">
                {inv.description ? (
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{inv.description}</ReactMarkdown>
                ) : (
                  <p className="text-[13px] text-[var(--color-text-dim)] italic">暂无描述</p>
                )}
              </div>
            )}
          </section>

          {/* 等待确认 banner */}
          {inv.status === 'awaiting_approval' && (
            <section className="mb-6 rounded-lg border border-[var(--color-warn)]/40 bg-[var(--color-warn)]/5 px-5 py-4">
              <div className="text-[15px] font-semibold text-[var(--color-warn)] mb-2">
                方案待确认
              </div>
              <p className="text-[13px] text-[var(--color-text-muted)] mb-4">
                Evaluator 已通过方案评审，请确认是否执行修复操作。确认后系统将自动执行并验证结果。
              </p>
              <div className="flex gap-3">
                <button
                  onClick={doApprove}
                  disabled={busy}
                  className="px-4 h-8 rounded-lg bg-[var(--color-ok)] text-white text-[13px] font-medium
                    hover:opacity-90 disabled:opacity-50 transition-opacity"
                >
                  确认执行
                </button>
                <button
                  onClick={() => setShowReject(true)}
                  disabled={busy}
                  className="px-4 h-8 rounded-lg border border-[var(--color-danger)]/40 text-[var(--color-danger)] text-[13px] font-medium
                    hover:bg-[var(--color-danger)]/5 disabled:opacity-50 transition-colors"
                >
                  拒绝方案
                </button>
              </div>
              {showReject && (
                <div className="mt-4 space-y-2">
                  <textarea
                    value={rejectFeedback}
                    onChange={(e) => setRejectFeedback(e.target.value)}
                    placeholder="请说明拒绝原因和改进方向（可选）"
                    rows={3}
                    className="w-full px-3 py-2 rounded border border-[var(--color-border-strong)]
                      bg-[var(--color-bg)] text-[13px] text-[var(--color-text)] leading-relaxed
                      focus:border-[var(--color-text)] focus:outline-none transition-colors"
                  />
                  <div className="flex gap-2 justify-end">
                    <button onClick={() => { setShowReject(false); setRejectFeedback('') }} className="orca-btn-secondary">
                      取消
                    </button>
                    <button onClick={doReject} disabled={busy} className="px-3 h-7 rounded bg-[var(--color-danger)] text-white text-[12px] font-medium disabled:opacity-50">
                      确认拒绝
                    </button>
                  </div>
                </div>
              )}
            </section>
          )}

          {/* 流水线进度 */}
          {isPipelineStatus && (
            <section className="mb-6">
              <PipelineProgress status={inv.status} />
            </section>
          )}

          {/* 解决结论 */}
          {resolved && (inv.root_cause || inv.solution) && (
            <section className="mb-6 rounded-lg border border-[var(--color-ok)]/40 bg-[var(--color-ok)]/5 px-5 py-4">
              <div className="text-[15px] font-semibold text-[var(--color-ok)] mb-3">
                已解决
              </div>
              {inv.root_cause && (
                <div className="mb-3">
                  <div className="text-[13px] text-[var(--color-text-muted)] font-semibold mb-1">根因</div>
                  <div className="orca-prose">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{inv.root_cause}</ReactMarkdown>
                  </div>
                </div>
              )}
              {inv.solution && (
                <div>
                  <div className="text-[13px] text-[var(--color-text-muted)] font-semibold mb-1">解决方案</div>
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
              <span className="text-[17px] font-semibold text-[var(--color-text)]">
                时间线
              </span>
              {!archived && (
                <button
                  onClick={() => setShowAddEntry(true)}
                  className="orca-btn-link text-[12px]"
                >
                  + 添加
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
                    <option value="note">备注</option>
                    <option value="discovery">发现</option>
                    <option value="action">操作</option>
                  </select>
                  <span className="text-[12px] text-[var(--color-text-dim)]">
                    手动添加
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
                      text-[12px] font-medium"
                  >
                    取消
                  </button>
                  <button
                    onClick={submitEntry}
                    disabled={busy || !entryContent.trim()}
                    className="orca-btn-primary"
                  >
                    添加
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
                <div className="flex items-center px-5 h-10 border-b border-[var(--color-border)] bg-[var(--color-bg)]">
                  <span className="text-[14px] font-medium text-[var(--color-text)]">结单</span>
                </div>
                <div className="px-5 pt-4 pb-4 space-y-3">
                  <div>
                    <label className="block text-[13px] text-[var(--color-text-muted)] mb-1.5">
                      根因分析
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
                    <label className="block text-[13px] text-[var(--color-text-muted)] mb-1.5">
                      解决方案
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
                  <button onClick={() => setAskResolve(false)} className="orca-btn-secondary">
                    取消
                  </button>
                  <button onClick={confirmResolve} disabled={busy} className="orca-btn-primary">
                    确认结单
                  </button>
                </div>
              </div>
            </div>
          )}
          </div>
        </div>
        {drawerOpen && (
          <aside className="w-[380px] shrink-0 border-l border-[var(--color-border)] flex flex-col min-h-0">
            <InvestigationChatDrawer
              investigation={inv}
              onClose={toggleDrawer}
            />
          </aside>
        )}
      </div>
    </div>
  )
}

/** 渲染结构化 solution entry（JSON: {description, actions}），fallback 到纯 markdown */
function SolutionContent({ content }: { content: string }) {
  try {
    const parsed = JSON.parse(content) as {
      description?: string
      actions?: { tool: string; args: string }[]
      commands?: string[] // 兼容旧格式
    }
    return (
      <>
        {parsed.description && (
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{parsed.description}</ReactMarkdown>
        )}
        {parsed.actions && parsed.actions.length > 0 && (
          <div className="mt-3">
            <div className="text-[12px] font-semibold text-[var(--color-text-muted)] mb-1.5">
              审批后将执行以下操作：
            </div>
            <div className="space-y-1.5">
              {parsed.actions.map((action, i) => {
                let argsDisplay = action.args
                try { argsDisplay = JSON.stringify(JSON.parse(action.args), null, 2) } catch {}
                return (
                  <div key={i} className="rounded bg-[var(--color-bg)] border border-[var(--color-border)] px-3 py-2">
                    <code className="text-[12px] font-mono font-semibold text-[var(--color-accent)]">{action.tool}</code>
                    <pre className="text-[11px] font-mono text-[var(--color-text-muted)] mt-1 whitespace-pre-wrap">{argsDisplay}</pre>
                  </div>
                )
              })}
            </div>
          </div>
        )}
        {parsed.commands && parsed.commands.length > 0 && (
          <div className="mt-3">
            <div className="text-[12px] font-semibold text-[var(--color-text-muted)] mb-1.5">
              审批后将执行以下命令：
            </div>
            <div className="space-y-1">
              {parsed.commands.map((cmd, i) => (
                <code key={i} className="block px-3 py-1.5 rounded bg-[var(--color-bg)] text-[12px] font-mono text-[var(--color-text)] border border-[var(--color-border)]">
                  {cmd}
                </code>
              ))}
            </div>
          </div>
        )}
      </>
    )
  } catch {
    return <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
  }
}

function TimelineEntry({ entry }: { entry: InvestigationEntry }) {
  const typeColor: Record<string, string> = {
    discovery: 'var(--color-accent)',
    action: 'var(--color-warn)',
    resolution: 'var(--color-ok)',
    note: 'var(--color-text-dim)',
    report: '#6366f1',    // indigo
    solution: '#0891b2',  // cyan
    review: '#d946ef',    // fuchsia
    verification: 'var(--color-ok)',
    status_change: 'var(--color-text-dim)',
  }
  const typeLabel: Record<string, string> = {
    discovery: '发现',
    action: '操作',
    resolution: '结论',
    note: '备注',
    report: '排查报告',
    solution: '修复方案',
    review: '评审',
    verification: '验证',
    status_change: '状态变更',
  }
  const typeIcon: Record<string, string> = {
    report: '📋',
    solution: '🔧',
    review: '📝',
    verification: '✅',
    status_change: '↗',
  }
  const color = typeColor[entry.type] || 'var(--color-text-dim)'

  // status_change 条目简化显示
  if (entry.type === 'status_change') {
    return (
      <div className="relative">
        <span
          className="absolute -left-[27px] top-[9px] w-2.5 h-2.5 rounded-full border-2 border-[var(--color-bg)] bg-[var(--color-border)]"
        />
        <div className="flex items-center gap-2 text-[12px] text-[var(--color-text-dim)]">
          <span>↗ 状态变更：{entry.content}</span>
          <span>{formatRelativeTime(entry.created_at)}</span>
        </div>
      </div>
    )
  }

  return (
    <div className="relative">
      <span
        className="absolute -left-[27px] top-[9px] w-2.5 h-2.5 rounded-full border-2 border-[var(--color-bg)]"
        style={{ backgroundColor: color }}
      />
      <div className="flex items-center gap-2 mb-1.5">
        <span
          className="inline-flex px-2 py-0.5 rounded text-[12px] font-semibold"
          style={{ color, backgroundColor: `color-mix(in srgb, ${color} 12%, transparent)` }}
        >
          {typeIcon[entry.type] ? typeIcon[entry.type] + ' ' : ''}{typeLabel[entry.type] || entry.type}
        </span>
        <span className="text-[12px] text-[var(--color-text-dim)]">
          {entry.author === 'ai' ? 'AI' : entry.author}
        </span>
        <span className="text-[12px] text-[var(--color-text-dim)]">
          {formatRelativeTime(entry.created_at)}
        </span>
      </div>
      <div className={`orca-prose text-[13.5px] ${
        ['report', 'solution', 'review'].includes(entry.type)
          ? 'rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3'
          : ''
      }`}>
        {entry.type === 'solution' ? (
          <SolutionContent content={entry.content} />
        ) : (
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{entry.content}</ReactMarkdown>
        )}
      </div>
    </div>
  )
}

const PIPELINE_STEPS: { status: string; label: string }[] = [
  { status: 'exploring', label: '诊断' },
  { status: 'explored', label: '诊断完成' },
  { status: 'generating', label: '生成方案' },
  { status: 'evaluating', label: '评审' },
  { status: 'awaiting_approval', label: '待确认' },
  { status: 'executing', label: '执行' },
  { status: 'verifying', label: '验证' },
]

function PipelineProgress({ status }: { status: string }) {
  const currentIdx = PIPELINE_STEPS.findIndex(s => s.status === status)
  return (
    <div className="flex items-center gap-1">
      {PIPELINE_STEPS.map((step, i) => {
        const isActive = i === currentIdx
        const isDone = i < currentIdx
        return (
          <div key={step.status} className="flex items-center gap-1">
            {i > 0 && (
              <div className={`w-4 h-[2px] ${isDone ? 'bg-[var(--color-ok)]' : 'bg-[var(--color-border)]'}`} />
            )}
            <div className={`flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-medium transition-all ${
              isActive
                ? 'bg-[var(--color-accent-soft)] text-[var(--color-accent)] ring-1 ring-[var(--color-accent)]/30'
                : isDone
                ? 'bg-[var(--color-ok)]/10 text-[var(--color-ok)]'
                : 'bg-[var(--color-surface-2)] text-[var(--color-text-dim)]'
            }`}>
              {isDone && <span>✓</span>}
              {isActive && <span className="inline-block w-1.5 h-1.5 rounded-full bg-current animate-pulse" />}
              <span>{step.label}</span>
            </div>
          </div>
        )
      })}
    </div>
  )
}
