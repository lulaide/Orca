import { useEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  listKnowledgePages,
  streamScanCluster,
  updateKnowledgePage,
  type KnowledgePage,
} from '../api'

// ---- 树节点 ----
interface TreeNode {
  page: KnowledgePage
  children: TreeNode[]
}

function buildTree(pages: KnowledgePage[]): TreeNode[] {
  const map = new Map<string, TreeNode>()
  for (const p of pages) map.set(p.slug, { page: p, children: [] })
  const roots: TreeNode[] = []
  for (const p of pages) {
    const node = map.get(p.slug)!
    if (p.parent_slug && map.has(p.parent_slug)) {
      map.get(p.parent_slug)!.children.push(node)
    } else {
      roots.push(node)
    }
  }
  return roots
}

// ---- 扫描日志条目 ----
interface ScanLogEntry {
  id: number
  role: string
  content?: string
  tool_name?: string
  tool_calls?: { name: string; arguments: string }[]
}

export function KnowledgePanel() {
  const [pages, setPages] = useState<KnowledgePage[] | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [scanning, setScanning] = useState(false)
  const [scanLog, setScanLog] = useState<ScanLogEntry[]>([])
  const [showLog, setShowLog] = useState(false)
  const scanAbortRef = useRef<{ abort: () => void } | null>(null)
  const logIdRef = useRef(0)

  const reload = () => {
    listKnowledgePages()
      .then((data) => setPages(data))
      .catch(() => {})
  }

  useEffect(() => { reload() }, [])

  const handleScan = () => {
    setScanning(true)
    setScanLog([])
    setShowLog(true)

    const handle = streamScanCluster({
      onMessage: (msg) => {
        const entry: ScanLogEntry = {
          id: ++logIdRef.current,
          role: (msg.role as string) || 'unknown',
          content: msg.content as string,
          tool_name: msg.tool_name as string,
        }
        if (msg.tool_calls) {
          entry.tool_calls = (msg.tool_calls as { name: string; arguments: string }[])
        }
        setScanLog((prev) => [...prev, entry])
      },
      onDone: () => {
        setScanning(false)
        reload()
      },
      onError: (err) => {
        setScanLog((prev) => [...prev, { id: ++logIdRef.current, role: 'error', content: err }])
        setScanning(false)
      },
    })
    scanAbortRef.current = handle
  }

  const tree = useMemo(() => (pages ? buildTree(pages) : []), [pages])
  const selectedPage = useMemo(
    () => pages?.find((p) => p.slug === selected) ?? null,
    [pages, selected],
  )
  const empty = pages !== null && pages.length === 0

  return (
    <div className="flex flex-col flex-1 min-h-0 h-full">
      {/* Header */}
      <header className="flex items-center justify-between px-6 h-11 border-b border-[var(--color-border)] bg-[var(--color-bg)] font-mono text-[11px]">
        <div className="flex items-center gap-2 text-[var(--color-text-dim)]">
          <span className="text-[var(--color-accent)]">~</span>
          <span>/</span>
          <span>orca</span>
          <span>/</span>
          <span className="text-[var(--color-text-muted)]">knowledge</span>
          {pages && <span className="ml-2 text-[var(--color-text-dim)]">{pages.length} pages</span>}
        </div>
        <div className="flex items-center gap-2">
          {scanLog.length > 0 && (
            <button type="button" onClick={() => setShowLog(!showLog)}
              className="px-2 py-1 text-[var(--color-text-dim)] hover:text-[var(--color-text)] transition-colors">
              {showLog ? '隐藏日志' : '查看日志'}
            </button>
          )}
          <button
            type="button"
            onClick={scanning ? () => scanAbortRef.current?.abort() : handleScan}
            disabled={false}
            className={`px-2.5 py-1 rounded border transition-colors
              ${scanning
                ? 'border-[var(--color-danger)]/40 text-[var(--color-danger)] hover:bg-[var(--color-danger)]/10'
                : 'border-[var(--color-border-strong)] bg-[var(--color-bg)] hover:bg-[var(--color-accent-soft)] hover:border-[var(--color-accent)] text-[var(--color-text)]'}`}
          >
            {scanning ? '停止' : '扫描集群'}
          </button>
        </div>
      </header>

      {/* 扫描日志面板 */}
      {showLog && scanLog.length > 0 && (
        <ScanLogPanel entries={scanLog} scanning={scanning} />
      )}

      {/* 空状态 */}
      {empty && !scanning && (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center max-w-md">
            <div className="text-[11.5px] uppercase tracking-[0.25em] text-[var(--color-text-dim)] font-mono mb-3">
              knowledge base
            </div>
            <h2 className="font-serif-display text-[32px] leading-tight text-[var(--color-text)] mb-3">
              知识库为空
            </h2>
            <p className="text-[13px] text-[var(--color-text-muted)] mb-5 leading-relaxed">
              点击右上角的"扫描集群"，Agent 会自主探索你的 Kubernetes 集群，
              生成结构化的集群知识文档——包括概述、服务架构、各 namespace 和服务详情。
            </p>
          </div>
        </div>
      )}

      {/* 主体：左树 + 右文档 */}
      {!empty && pages && pages.length > 0 && !showLog && (
        <div className="flex flex-1 min-h-0">
          {/* 左侧目录导航 */}
          <nav className="w-60 shrink-0 border-r border-[var(--color-border)] overflow-y-auto bg-[var(--color-surface)]">
            <div className="px-3 py-3">
              {tree.map((node) => (
                <NavNode key={node.page.slug} node={node} depth={0}
                  selected={selected} onSelect={setSelected} />
              ))}
            </div>
          </nav>

          {/* 右侧文档内容 */}
          <main className="flex-1 overflow-y-auto">
            {!selectedPage && (
              <div className="flex items-center justify-center h-full text-[13px] text-[var(--color-text-dim)]">
                选择左侧目录查看文档
              </div>
            )}
            {selectedPage && (
              <PageContent page={selectedPage} onUpdated={reload} />
            )}
          </main>
        </div>
      )}
    </div>
  )
}

// ---- 左侧树形导航节点 ----

function NavNode({
  node, depth, selected, onSelect,
}: {
  node: TreeNode
  depth: number
  selected: string | null
  onSelect: (slug: string) => void
}) {
  const [collapsed, setCollapsed] = useState(false)
  const active = node.page.slug === selected
  const hasChildren = node.children.length > 0

  return (
    <div>
      <button
        type="button"
        onClick={() => {
          onSelect(node.page.slug)
          if (hasChildren && active) setCollapsed(!collapsed)
        }}
        className={`w-full flex items-center gap-1.5 px-2 py-1.5 rounded text-left
          text-[12.5px] transition-colors
          ${active
            ? 'bg-[var(--color-bg)] text-[var(--color-text)] font-medium'
            : 'text-[var(--color-text-muted)] hover:bg-[var(--color-bg)] hover:text-[var(--color-text)]'}`}
        style={{ paddingLeft: `${8 + depth * 14}px` }}
      >
        {hasChildren && (
          <span className="text-[10px] w-3 shrink-0 text-center"
            onClick={(e) => { e.stopPropagation(); setCollapsed(!collapsed) }}>
            {collapsed ? '▸' : '▾'}
          </span>
        )}
        {!hasChildren && <span className="w-3 shrink-0" />}
        <span className="truncate">{node.page.title}</span>
      </button>
      {!collapsed && hasChildren && (
        <div>
          {node.children.map((child) => (
            <NavNode key={child.page.slug} node={child} depth={depth + 1}
              selected={selected} onSelect={onSelect} />
          ))}
        </div>
      )}
    </div>
  )
}

// ---- 右侧文档内容 ----

function PageContent({ page, onUpdated }: { page: KnowledgePage; onUpdated: () => void }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(page.content)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setDraft(page.content)
    setEditing(false)
  }, [page.slug])

  const handleSave = async () => {
    setSaving(true)
    try {
      await updateKnowledgePage(page.slug, draft)
      setEditing(false)
      onUpdated()
    } catch { /* */ } finally { setSaving(false) }
  }

  return (
    <div className="max-w-3xl mx-auto px-10 py-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="text-[10.5px] font-mono text-[var(--color-text-dim)] mb-1">
            {page.slug}
          </div>
          <h1 className="font-serif-display text-[32px] leading-tight text-[var(--color-text)]">
            {page.title}
          </h1>
        </div>
        {!editing && (
          <button type="button" onClick={() => setEditing(true)}
            className="text-[11px] font-mono text-[var(--color-accent)] hover:underline shrink-0">
            编辑
          </button>
        )}
      </div>

      {!editing ? (
        <div className="orca-prose">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{page.content || '*暂无内容*'}</ReactMarkdown>
        </div>
      ) : (
        <div className="space-y-3">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={20}
            className="w-full px-3 py-2 rounded border border-[var(--color-border-strong)]
              bg-[var(--color-bg)] text-[13px] text-[var(--color-text)]
              focus:outline-none focus:border-[var(--color-text)]
              font-mono leading-relaxed resize-y transition-colors"
          />
          <div className="flex items-center gap-2">
            <button type="button" onClick={handleSave} disabled={saving}
              className="h-8 px-4 rounded bg-[var(--color-accent)] text-[var(--color-bg)]
                hover:bg-[var(--color-accent-hover)] disabled:opacity-50
                font-mono text-[11px] uppercase tracking-[0.15em] transition-colors">
              {saving ? '保存中…' : '保存'}
            </button>
            <button type="button" onClick={() => { setDraft(page.content); setEditing(false) }}
              className="h-8 px-3 rounded border border-[var(--color-border-strong)]
                text-[var(--color-text-muted)] hover:bg-[var(--color-surface)]
                font-mono text-[11px] transition-colors">
              取消
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ---- 扫描日志面板 ----

function ScanLogPanel({ entries, scanning }: { entries: ScanLogEntry[]; scanning: boolean }) {
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [entries.length])

  return (
    <div className="border-b border-[var(--color-border)] bg-[var(--color-surface)]/50 max-h-[40vh] overflow-y-auto">
      <div className="max-w-3xl mx-auto px-6 py-4 space-y-2">
        <div className="text-[10.5px] font-mono uppercase tracking-[0.2em] text-[var(--color-text-dim)] mb-2 flex items-center gap-2">
          agent scan log
          {scanning && <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-accent)] animate-pulse" />}
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
  if (entry.role === 'error') {
    return (
      <div className="text-[12px] text-[var(--color-danger)] font-mono">
        ERROR: {entry.content}
      </div>
    )
  }
  if (entry.role === 'tool') {
    return (
      <div className="text-[12px] font-mono text-[var(--color-text-dim)] pl-4 border-l-2 border-[var(--color-border)]">
        <span className="text-[var(--color-text-muted)]">{entry.tool_name}</span>
        <span className="ml-1">→</span>
        <span className="ml-1 truncate inline-block max-w-[500px] align-bottom">
          {(entry.content || '').slice(0, 120)}{(entry.content || '').length > 120 ? '…' : ''}
        </span>
      </div>
    )
  }
  if (entry.tool_calls && entry.tool_calls.length > 0) {
    return (
      <div className="text-[12px] font-mono space-y-0.5">
        {entry.content && (
          <div className="text-[var(--color-text-muted)]">{entry.content}</div>
        )}
        {entry.tool_calls.map((tc, i) => (
          <div key={i} className="text-[var(--color-accent)] pl-2">
            {tc.name}({(tc.arguments || '').slice(0, 80)}{(tc.arguments || '').length > 80 ? '…' : ''})
          </div>
        ))}
      </div>
    )
  }
  if (entry.content) {
    return (
      <div className="text-[12.5px] text-[var(--color-text)]">
        {entry.content.slice(0, 200)}{entry.content.length > 200 ? '…' : ''}
      </div>
    )
  }
  return null
}
