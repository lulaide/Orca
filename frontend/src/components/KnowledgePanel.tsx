import { useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { MermaidBlock } from './MermaidBlock'
import {
  listSkills,
  getSkill,
  updateSkill,
  getSkillRef,
  updateSkillRef,
  startScan,
  streamScanProgress,
  type Skill,
} from '../api'

interface ScanLogEntry {
  id: number
  role: string
  content?: string
  tool_name?: string
  tool_calls?: { name: string; arguments: string }[]
}

// Markdown 代码块支持 mermaid 渲染
const mdComponents = {
  pre({ children, ...props }: React.ComponentProps<'pre'>) {
    // 检查是否是 mermaid 代码块
    if (children && typeof children === 'object' && 'props' in children) {
      const child = children as React.ReactElement<{ className?: string; children?: string }>
      const match = /language-mermaid/.exec(child.props.className || '')
      if (match) {
        const code = typeof child.props.children === 'string' ? child.props.children : ''
        return <MermaidBlock code={code.replace(/\n$/, '')} />
      }
    }
    return <pre {...props}>{children}</pre>
  },
}

export function KnowledgePanel() {
  const [skills, setSkills] = useState<Skill[] | null>(null)
  const [selectedSkill, setSelectedSkill] = useState<Skill | null>(null)
  const [activeRef, setActiveRef] = useState<string | null>(null) // 当前查看的 reference
  const [refContent, setRefContent] = useState<string>('')
  const [scanning, setScanning] = useState(false)
  const [scanLog, setScanLog] = useState<ScanLogEntry[]>([])
  const [showLog, setShowLog] = useState(false)
  const scanAbortRef = useRef<{ abort: () => void } | null>(null)
  const logIdRef = useRef(0)

  const reload = () => {
    listSkills().then(setSkills).catch(() => {})
  }

  useEffect(() => {
    reload()
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
      onDone: () => { setScanning(false); setShowLog(false); reload() },
      onError: (err) => {
        setScanLog((prev) => [...prev, { id: ++logIdRef.current, role: 'error', content: err }])
        setScanning(false)
      },
      onNoScan: () => {},
    })
    scanAbortRef.current = handle
    return () => handle.abort()
  }, [])

  // 从 URL 读取当前 skill name
  useEffect(() => {
    const path = window.location.pathname
    if (path.startsWith('/knowledge/')) {
      const name = path.slice('/knowledge/'.length)
      if (name) {
        getSkill(name).then((s) => { setSelectedSkill(s); setActiveRef(null) }).catch(() => setSelectedSkill(null))
      }
    }
  }, [window.location.pathname])

  useEffect(() => {
    const onPop = () => {
      const path = window.location.pathname
      if (path.startsWith('/knowledge/')) {
        const name = path.slice('/knowledge/'.length)
        if (name) getSkill(name).then((s) => { setSelectedSkill(s); setActiveRef(null) }).catch(() => {})
      } else {
        setSelectedSkill(null)
      }
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  // 加载 reference 内容
  useEffect(() => {
    if (!selectedSkill || !activeRef) { setRefContent(''); return }
    getSkillRef(selectedSkill.name, activeRef).then(setRefContent).catch(() => setRefContent('加载失败'))
  }, [selectedSkill?.name, activeRef])

  const handleScan = async () => {
    try { await startScan() } catch (e) {
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
      onDone: () => { setScanning(false); setShowLog(false); reload() },
      onError: (err) => {
        setScanLog((prev) => [...prev, { id: ++logIdRef.current, role: 'error', content: err }])
        setScanning(false)
      },
    })
    scanAbortRef.current = handle
  }

  const empty = skills !== null && skills.length === 0 && !scanning
  const refNames = selectedSkill?.references ? Object.keys(selectedSkill.references) : []

  return (
    <div className="flex flex-col flex-1 min-h-0 h-full">
      {/* 顶部工具栏 */}
      <header className="flex items-center justify-between px-4 md:px-6 h-12 border-b border-[var(--color-border)] bg-[var(--color-bg)]">
        <span className="text-[14px] font-medium text-[var(--color-text)]">
          {selectedSkill ? selectedSkill.name : '技能库'}
        </span>
        <div className="flex items-center gap-2">
          {scanLog.length > 0 && (
            <button type="button" onClick={() => setShowLog(!showLog)}
              className="px-2 py-1 text-[12px] text-[var(--color-text-dim)] hover:text-[var(--color-text)]">
              {showLog ? '隐藏日志' : '查看日志'}
            </button>
          )}
          <button type="button"
            onClick={scanning ? () => scanAbortRef.current?.abort() : handleScan}
            className={scanning ? 'orca-btn-danger' : 'orca-btn-secondary'}
          >
            {scanning ? '停止' : '扫描集群'}
          </button>
        </div>
      </header>

      {/* 扫描进度条 */}
      {scanning && (
        <div className="h-1 bg-[var(--color-surface-2)]">
          <div className="h-full bg-[var(--color-accent)] animate-pulse" style={{ width: '60%' }} />
        </div>
      )}

      {/* 扫描日志 */}
      {showLog && scanLog.length > 0 && <ScanLogPanel entries={scanLog} scanning={scanning} />}

      {/* 内容区 */}
      {empty && !showLog && (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center max-w-md">
            <h2 className="font-semibold text-[22px] text-[var(--color-text)] mb-3">技能库为空</h2>
            <p className="text-[13px] text-[var(--color-text-muted)] leading-relaxed">
              点击"扫描集群"，Agent 会探索 Kubernetes 集群并为每个服务生成结构化的技能文档。
            </p>
          </div>
        </div>
      )}

      {selectedSkill && !showLog && (
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-3xl mx-auto px-6 md:px-10 py-8">
            {/* 标题 + 描述 */}
            <h1 className="font-semibold text-[22px] text-[var(--color-text)] mb-2">{selectedSkill.name}</h1>
            <p className="text-[13px] text-[var(--color-text-muted)] mb-6">{selectedSkill.description}</p>

            {/* Tab 栏 */}
            {refNames.length > 0 && (
              <div className="flex gap-1 mb-6 border-b border-[var(--color-border)]">
                <TabButton active={activeRef === null} onClick={() => setActiveRef(null)}>概述</TabButton>
                {refNames.map((ref) => (
                  <TabButton key={ref} active={activeRef === ref} onClick={() => setActiveRef(ref)}>
                    {ref.replace('.md', '')}
                  </TabButton>
                ))}
              </div>
            )}

            {/* 内容 */}
            {activeRef === null ? (
              <SkillContent skill={selectedSkill} onUpdated={reload} />
            ) : (
              <RefContent
                skillName={selectedSkill.name}
                refName={activeRef}
                content={refContent}
                onUpdated={() => {
                  getSkillRef(selectedSkill.name, activeRef).then(setRefContent).catch(() => {})
                }}
              />
            )}
          </div>
        </div>
      )}

      {!selectedSkill && !empty && !showLog && (
        <div className="flex-1 flex items-center justify-center text-[13px] text-[var(--color-text-dim)]">
          选择左侧技能查看详情
        </div>
      )}
    </div>
  )
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick}
      className={`px-3 py-2 text-[13px] font-medium border-b-2 -mb-px transition-colors ${
        active
          ? 'border-[var(--color-accent)] text-[var(--color-accent)]'
          : 'border-transparent text-[var(--color-text-dim)] hover:text-[var(--color-text)]'
      }`}
    >
      {children}
    </button>
  )
}

function SkillContent({ skill, onUpdated }: { skill: Skill; onUpdated: () => void }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(skill.content)
  const [saving, setSaving] = useState(false)

  useEffect(() => { setDraft(skill.content); setEditing(false) }, [skill.name])

  const handleSave = async () => {
    setSaving(true)
    try { await updateSkill(skill.name, { content: draft }); setEditing(false); onUpdated() }
    catch { /* */ } finally { setSaving(false) }
  }

  return (
    <div>
      <div className="flex items-center justify-end mb-4">
        {!editing && (
          <button type="button" onClick={() => setEditing(true)}
            className="orca-btn-link text-[12px]">编辑</button>
        )}
      </div>
      {!editing ? (
        <div className="orca-prose">
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
            {skill.content || '*暂无内容*'}
          </ReactMarkdown>
        </div>
      ) : (
        <div className="space-y-3">
          <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={20}
            className="w-full px-3 py-2 rounded border border-[var(--color-border-strong)]
              bg-[var(--color-bg)] text-[13px] text-[var(--color-text)]
              focus:outline-none focus:border-[var(--color-text)]
              font-mono leading-relaxed resize-y" />
          <div className="flex gap-2">
            <button type="button" onClick={handleSave} disabled={saving} className="orca-btn-primary">
              {saving ? '保存中…' : '保存'}
            </button>
            <button type="button" onClick={() => { setDraft(skill.content); setEditing(false) }}
              className="orca-btn-secondary">取消</button>
          </div>
        </div>
      )}
    </div>
  )
}

function RefContent({ skillName, refName, content, onUpdated }: {
  skillName: string; refName: string; content: string; onUpdated: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(content)
  const [saving, setSaving] = useState(false)

  useEffect(() => { setDraft(content); setEditing(false) }, [content, refName])

  const handleSave = async () => {
    setSaving(true)
    try { await updateSkillRef(skillName, refName, draft); setEditing(false); onUpdated() }
    catch { /* */ } finally { setSaving(false) }
  }

  return (
    <div>
      <div className="flex items-center justify-end mb-4">
        {!editing && (
          <button type="button" onClick={() => setEditing(true)}
            className="orca-btn-link text-[12px]">编辑</button>
        )}
      </div>
      {!editing ? (
        <div className="orca-prose">
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
            {content || '*暂无内容*'}
          </ReactMarkdown>
        </div>
      ) : (
        <div className="space-y-3">
          <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={20}
            className="w-full px-3 py-2 rounded border border-[var(--color-border-strong)]
              bg-[var(--color-bg)] text-[13px] text-[var(--color-text)]
              focus:outline-none focus:border-[var(--color-text)]
              font-mono leading-relaxed resize-y" />
          <div className="flex gap-2">
            <button type="button" onClick={handleSave} disabled={saving} className="orca-btn-primary">
              {saving ? '保存中…' : '保存'}
            </button>
            <button type="button" onClick={() => { setDraft(content); setEditing(false) }}
              className="orca-btn-secondary">取消</button>
          </div>
        </div>
      )}
    </div>
  )
}

function ScanLogPanel({ entries, scanning }: { entries: ScanLogEntry[]; scanning: boolean }) {
  const bottomRef = useRef<HTMLDivElement>(null)
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [entries.length])

  return (
    <div className="border-b border-[var(--color-border)] bg-[var(--color-surface)]/50 max-h-[40vh] overflow-y-auto">
      <div className="max-w-3xl mx-auto px-6 py-4 space-y-2">
        <div className="text-[11px] font-medium text-[var(--color-text-dim)] flex items-center gap-2">
          扫描日志 {scanning && <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-accent)] animate-pulse" />}
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
