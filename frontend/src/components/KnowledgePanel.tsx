import { useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  listKnowledgePages,
  getKnowledgePage,
  startScan,
  streamScanProgress,
  updateKnowledgePage,
  type KnowledgePage,
} from '../api'

interface ScanLogEntry {
  id: number
  role: string
  content?: string
  tool_name?: string
  tool_calls?: { name: string; arguments: string }[]
}

export function KnowledgePanel() {
  const [pages, setPages] = useState<KnowledgePage[] | null>(null)
  const [selectedPage, setSelectedPage] = useState<KnowledgePage | null>(null)
  const [scanning, setScanning] = useState(false)
  const [scanLog, setScanLog] = useState<ScanLogEntry[]>([])
  const [showLog, setShowLog] = useState(false)
  const scanAbortRef = useRef<{ abort: () => void } | null>(null)
  const logIdRef = useRef(0)

  const reload = () => {
    listKnowledgePages().then(setPages).catch(() => {})
  }

  useEffect(() => {
    reload()
    // 自动检测是否有正在进行的扫描，有就重连
    const handle = streamScanProgress({
      onMessage: (msg) => {
        setScanning(true)
        setShowLog(true)
        setScanLog((prev) => [...prev, {
          id: ++logIdRef.current,
          role: (msg.role as string) || 'unknown',
          content: msg.content as string,
          tool_name: msg.tool_name as string,
          tool_calls: msg.tool_calls as { name: string; arguments: string }[],
        }])
      },
      onDone: () => { setScanning(false); reload() },
      onError: (err) => {
        setScanLog((prev) => [...prev, { id: ++logIdRef.current, role: 'error', content: err }])
        setScanning(false)
      },
      onNoScan: () => { /* 没有进行中的扫描，什么都不做 */ },
    })
    scanAbortRef.current = handle
    return () => handle.abort()
  }, [])

  // 从 URL 读取当前 slug
  useEffect(() => {
    const path = window.location.pathname
    if (path.startsWith('/knowledge/')) {
      const slug = path.slice('/knowledge/'.length)
      if (slug) {
        getKnowledgePage(slug).then(setSelectedPage).catch(() => setSelectedPage(null))
      }
    }
  }, [window.location.pathname])

  // popstate 监听
  useEffect(() => {
    const onPop = () => {
      const path = window.location.pathname
      if (path.startsWith('/knowledge/')) {
        const slug = path.slice('/knowledge/'.length)
        if (slug) getKnowledgePage(slug).then(setSelectedPage).catch(() => {})
      } else {
        setSelectedPage(null)
      }
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const handleScan = async () => {
    try {
      await startScan()
    } catch (e) {
      setScanLog([{ id: ++logIdRef.current, role: 'error', content: e instanceof Error ? e.message : '启动失败' }])
      setShowLog(true)
      return
    }
    setScanning(true)
    setScanLog([])
    setShowLog(true)

    const handle = streamScanProgress({
      onMessage: (msg) => {
        setScanLog((prev) => [...prev, {
          id: ++logIdRef.current,
          role: (msg.role as string) || 'unknown',
          content: msg.content as string,
          tool_name: msg.tool_name as string,
          tool_calls: msg.tool_calls as { name: string; arguments: string }[],
        }])
      },
      onDone: () => { setScanning(false); reload() },
      onError: (err) => {
        setScanLog((prev) => [...prev, { id: ++logIdRef.current, role: 'error', content: err }])
        setScanning(false)
      },
    })
    scanAbortRef.current = handle
  }

  const empty = pages !== null && pages.length === 0 && !scanning

  return (
    <div className="flex flex-col flex-1 min-h-0 h-full">
      {/* 顶部工具栏 */}
      <header className="flex items-center justify-between px-6 h-11 border-b border-[var(--color-border)] bg-[var(--color-bg)] font-mono text-[11px]">
        <div className="flex items-center gap-2 text-[var(--color-text-dim)]">
          <span className="text-[var(--color-text-muted)]">
            {selectedPage ? selectedPage.title : '知识库'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {scanLog.length > 0 && (
            <button type="button" onClick={() => setShowLog(!showLog)}
              className="px-2 py-1 text-[var(--color-text-dim)] hover:text-[var(--color-text)]">
              {showLog ? '隐藏日志' : '查看日志'}
            </button>
          )}
          <button type="button"
            onClick={scanning ? () => scanAbortRef.current?.abort() : handleScan}
            className={`px-2.5 py-1 rounded border transition-colors
              ${scanning
                ? 'border-[var(--color-danger)]/40 text-[var(--color-danger)]'
                : 'border-[var(--color-border-strong)] hover:border-[var(--color-accent)] text-[var(--color-text)]'}`}
          >
            {scanning ? '停止' : '扫描集群'}
          </button>
        </div>
      </header>

      {/* 扫描日志 */}
      {showLog && scanLog.length > 0 && <ScanLogPanel entries={scanLog} scanning={scanning} />}

      {/* 内容区 */}
      {empty && !showLog && (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center max-w-md">
            <h2 className="font-serif-display text-[28px] text-[var(--color-text)] mb-3">知识库为空</h2>
            <p className="text-[13px] text-[var(--color-text-muted)] leading-relaxed">
              点击"扫描集群"，Agent 会探索 Kubernetes 集群并生成结构化文档。
            </p>
          </div>
        </div>
      )}

      {selectedPage && !showLog && (
        <PageContent page={selectedPage} onUpdated={reload} />
      )}

      {!selectedPage && !empty && !showLog && (
        <div className="flex-1 flex items-center justify-center text-[13px] text-[var(--color-text-dim)]">
          选择左侧目录查看文档
        </div>
      )}
    </div>
  )
}

function PageContent({ page, onUpdated }: { page: KnowledgePage; onUpdated: () => void }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(page.content)
  const [saving, setSaving] = useState(false)

  useEffect(() => { setDraft(page.content); setEditing(false) }, [page.slug])

  const handleSave = async () => {
    setSaving(true)
    try { await updateKnowledgePage(page.slug, draft); setEditing(false); onUpdated() }
    catch { /* */ } finally { setSaving(false) }
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-3xl mx-auto px-10 py-8">
        <div className="flex items-center justify-between mb-6">
          <h1 className="font-serif-display text-[28px] text-[var(--color-text)]">{page.title}</h1>
          {!editing && (
            <button type="button" onClick={() => setEditing(true)}
              className="text-[11px] font-mono text-[var(--color-accent)] hover:underline">编辑</button>
          )}
        </div>
        {!editing ? (
          <div className="orca-prose">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{page.content || '*暂无内容*'}</ReactMarkdown>
          </div>
        ) : (
          <div className="space-y-3">
            <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={20}
              className="w-full px-3 py-2 rounded border border-[var(--color-border-strong)]
                bg-[var(--color-bg)] text-[13px] text-[var(--color-text)]
                focus:outline-none focus:border-[var(--color-text)]
                font-mono leading-relaxed resize-y" />
            <div className="flex gap-2">
              <button type="button" onClick={handleSave} disabled={saving}
                className="h-8 px-4 rounded bg-[var(--color-accent)] text-[var(--color-bg)]
                  disabled:opacity-50 font-mono text-[11px] uppercase tracking-[0.15em]">
                {saving ? '保存中…' : '保存'}
              </button>
              <button type="button" onClick={() => { setDraft(page.content); setEditing(false) }}
                className="h-8 px-3 rounded border border-[var(--color-border-strong)]
                  text-[var(--color-text-muted)] font-mono text-[11px]">取消</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function ScanLogPanel({ entries, scanning }: { entries: ScanLogEntry[]; scanning: boolean }) {
  const bottomRef = useRef<HTMLDivElement>(null)
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [entries.length])

  return (
    <div className="border-b border-[var(--color-border)] bg-[var(--color-surface)]/50 max-h-[40vh] overflow-y-auto">
      <div className="max-w-3xl mx-auto px-6 py-4 space-y-2">
        <div className="text-[10.5px] font-mono uppercase tracking-[0.2em] text-[var(--color-text-dim)] flex items-center gap-2">
          scan log {scanning && <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-accent)] animate-pulse" />}
        </div>
        {entries.map((e) => (
          <LogEntry key={e.id} entry={e} />
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}

function LogEntry({ entry }: { entry: ScanLogEntry }) {
  if (entry.role === 'error') return <div className="text-[12px] text-[var(--color-danger)] font-mono">ERROR: {entry.content}</div>
  if (entry.role === 'tool') return (
    <div className="text-[12px] font-mono text-[var(--color-text-dim)] pl-4 border-l-2 border-[var(--color-border)]">
      <span className="text-[var(--color-text-muted)]">{entry.tool_name}</span> → {(entry.content || '').slice(0, 100)}{(entry.content || '').length > 100 ? '…' : ''}
    </div>
  )
  if (entry.tool_calls) return (
    <div className="text-[12px] font-mono">
      {entry.content && <div className="text-[var(--color-text-muted)]">{entry.content}</div>}
      {entry.tool_calls.map((tc, i) => <div key={i} className="text-[var(--color-accent)] pl-2">{tc.name}(...)</div>)}
    </div>
  )
  if (entry.content) return <div className="text-[12.5px] text-[var(--color-text)]">{entry.content.slice(0, 200)}</div>
  return null
}
