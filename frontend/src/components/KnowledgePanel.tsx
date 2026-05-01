import { useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { MermaidBlock } from './MermaidBlock'
import {
  listSkills,
  getSkill,
  updateSkill,
  startScan,
  streamScanProgress,
  scanRepo,
  installSkillsFromRepo,
  type Skill,
  type DiscoveredSkill,
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
  const [scanning, setScanning] = useState(false)
  const [scanLog, setScanLog] = useState<ScanLogEntry[]>([])
  const [showLog, setShowLog] = useState(false)
  const [showMarket, setShowMarket] = useState(false)
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
      if (name === '__marketplace__') {
        setSelectedSkill(null)
        setShowMarket(true)
        return
      }
      if (name) {
        setShowMarket(false)
        getSkill(name).then((s) => { setSelectedSkill(s) }).catch(() => setSelectedSkill(null))
      }
    }
  }, [window.location.pathname])

  useEffect(() => {
    const onPop = () => {
      const path = window.location.pathname
      if (path.startsWith('/knowledge/')) {
        const name = path.slice('/knowledge/'.length)
        if (name === '__marketplace__') {
          setSelectedSkill(null); setShowMarket(true)
        } else if (name) {
          setShowMarket(false)
          getSkill(name).then((s) => { setSelectedSkill(s) }).catch(() => {})
        }
      } else {
        setSelectedSkill(null); setShowMarket(false)
      }
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

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
        <InstalledSkillDetail skill={selectedSkill} onUpdated={reload} />
      )}

      {/* Marketplace 页面 */}
      {showMarket && !showLog && (
        <InstallSkillsPage onInstalled={reload} />
      )}

      {!selectedSkill && !showMarket && !empty && !showLog && (
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

// ---- 安装技能页面 ----

function InstallSkillsPage({ onInstalled }: { onInstalled: () => void }) {
  const [repoInput, setRepoInput] = useState('')
  const [scanning, setScanning] = useState(false)
  const [scannedRepo, setScannedRepo] = useState('')
  const [skills, setSkills] = useState<DiscoveredSkill[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState('')
  const [installing, setInstalling] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<{ installed: string[]; errors: string[] } | null>(null)
  const [preview, setPreview] = useState<DiscoveredSkill | null>(null)

  const handleScan = async () => {
    if (!repoInput.trim()) return
    setScanning(true)
    setError('')
    setSkills([])
    setSelected(new Set())
    setResult(null)
    setPreview(null)
    try {
      const res = await scanRepo(repoInput.trim())
      setScannedRepo(res.repo)
      setSkills(res.skills)
    } catch (e) {
      setError(e instanceof Error ? e.message : '扫描失败')
    }
    setScanning(false)
  }

  const toggleSelect = (name: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  const selectAll = () => {
    const filtered = filteredSkills()
    const notInstalled = filtered.filter((s) => !s.installed)
    if (notInstalled.every((s) => selected.has(s.name))) {
      setSelected((prev) => {
        const next = new Set(prev)
        notInstalled.forEach((s) => next.delete(s.name))
        return next
      })
    } else {
      setSelected((prev) => {
        const next = new Set(prev)
        notInstalled.forEach((s) => next.add(s.name))
        return next
      })
    }
  }

  const handleInstall = async () => {
    if (selected.size === 0) return
    setInstalling(true)
    setResult(null)
    try {
      const toInstall = skills
        .filter((s) => selected.has(s.name))
        .map((s) => ({ name: s.name, path: s.path }))
      const res = await installSkillsFromRepo(scannedRepo, toInstall)
      setResult(res)
      onInstalled()
      const updated = skills.map((s) => ({
        ...s,
        installed: s.installed || res.installed.includes(s.name),
      }))
      setSkills(updated)
      setSelected(new Set())
    } catch (e) {
      setError(e instanceof Error ? e.message : '安装失败')
    }
    setInstalling(false)
  }

  const filteredSkills = () => {
    if (!search.trim()) return skills
    const q = search.toLowerCase()
    return skills.filter(
      (s) => s.name.toLowerCase().includes(q) || (s.description || '').toLowerCase().includes(q),
    )
  }

  const filtered = filteredSkills()
  const notInstalledCount = filtered.filter((s) => !s.installed).length

  return (
    <div className="flex-1 flex min-h-0">
      {/* 左侧列表 */}
      <div className="flex-1 overflow-y-auto border-r border-[var(--color-border)]">
        <div className="px-6 py-6">
          <h1 className="text-[20px] font-semibold text-[var(--color-text)] mb-1">安装技能</h1>
          <p className="text-[12px] text-[var(--color-text-muted)] mb-5">
            从 GitHub 仓库安装遵循 <a href="https://agentskills.io" target="_blank" rel="noreferrer"
              className="text-[var(--color-accent)] hover:underline">SKILL.md 开放标准</a> 的技能
          </p>

          <div className="flex gap-2 mb-5">
            <input
              value={repoInput}
              onChange={(e) => setRepoInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleScan()}
              placeholder="GitHub 仓库，如 anthropics/skills"
              className="flex-1 px-3 py-2 rounded-lg border border-[var(--color-border-strong)]
                bg-[var(--color-bg)] text-[13px] text-[var(--color-text)]
                focus:border-[var(--color-accent)] focus:outline-none"
            />
            <button type="button" onClick={handleScan} disabled={scanning || !repoInput.trim()}
              className="orca-btn-primary text-[12px] px-4">
              {scanning ? '扫描中…' : '扫描'}
            </button>
          </div>

          {error && <div className="text-[12px] text-[var(--color-danger)] mb-3">{error}</div>}

          {result && result.installed.length > 0 && (
            <div className="rounded-lg border border-[var(--color-ok)]/40 bg-[var(--color-ok)]/5 px-3 py-2 mb-3 text-[12px] text-[var(--color-ok)]">
              已安装 {result.installed.length} 个技能
            </div>
          )}

          {skills.length > 0 && (
            <>
              <div className="flex items-center justify-between mb-2">
                <span className="text-[13px] font-semibold text-[var(--color-text)]">
                  发现 {skills.length} 个技能
                </span>
                <div className="flex items-center gap-2">
                  {notInstalledCount > 0 && (
                    <button type="button" onClick={selectAll}
                      className="text-[11px] text-[var(--color-accent)] hover:underline">
                      {filtered.filter((s) => !s.installed).every((s) => selected.has(s.name)) ? '取消全选' : '全选'}
                    </button>
                  )}
                  {selected.size > 0 && (
                    <button type="button" onClick={handleInstall} disabled={installing}
                      className="orca-btn-primary text-[11px] px-3 py-1">
                      {installing ? '…' : `安装 (${selected.size})`}
                    </button>
                  )}
                </div>
              </div>

              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="搜索…"
                className="w-full px-3 py-1.5 rounded border border-[var(--color-border)]
                  bg-[var(--color-bg)] text-[12px] text-[var(--color-text)]
                  focus:border-[var(--color-accent)] focus:outline-none mb-2"
              />

              <div className="space-y-0.5">
                {filtered.map((sk) => (
                  <div
                    key={sk.name}
                    onClick={() => setPreview(sk)}
                    className={`flex items-center gap-2.5 px-3 py-2.5 rounded-lg cursor-pointer transition-colors
                      ${preview?.name === sk.name ? 'bg-[var(--color-surface-2)]' : 'hover:bg-[var(--color-surface-2)]/50'}`}
                  >
                    {/* 复选框 */}
                    <div
                      onClick={(e) => !sk.installed && toggleSelect(sk.name, e)}
                      className={`w-4 h-4 rounded border-2 shrink-0 flex items-center justify-center cursor-pointer
                        ${sk.installed
                          ? 'border-[var(--color-ok)] bg-[var(--color-ok)]'
                          : selected.has(sk.name)
                            ? 'border-[var(--color-accent)] bg-[var(--color-accent)]'
                            : 'border-[var(--color-border-strong)] hover:border-[var(--color-accent)]'}`}
                    >
                      {(sk.installed || selected.has(sk.name)) && (
                        <svg viewBox="0 0 12 12" className="w-2.5 h-2.5 text-white" fill="none" stroke="currentColor" strokeWidth="2">
                          <polyline points="2 6 5 9 10 3" />
                        </svg>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-[13px] font-semibold text-[var(--color-text)] truncate">{sk.name}</span>
                        {sk.installed && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[var(--color-ok)]/10 text-[var(--color-ok)] shrink-0">已安装</span>
                        )}
                      </div>
                      <p className="text-[11px] text-[var(--color-text-dim)] truncate mt-0.5">
                        {(sk.description || '').slice(0, 80)}{(sk.description || '').length > 80 ? '…' : ''}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {scanning && (
            <div className="text-center py-12">
              <div className="inline-block w-5 h-5 border-2 border-[var(--color-accent)] border-t-transparent rounded-full animate-spin mb-3" />
              <p className="text-[12px] text-[var(--color-text-dim)]">正在扫描仓库…</p>
            </div>
          )}

          {!scanning && skills.length === 0 && !error && (
            <div className="text-center py-12 text-[12px] text-[var(--color-text-dim)]">
              输入 GitHub 仓库地址，扫描发现可安装的技能
            </div>
          )}
        </div>
      </div>

      {/* 右侧预览 */}
      <div className="w-1/2 overflow-y-auto hidden md:block">
        {preview ? (
          <SkillPreview preview={preview} scannedRepo={scannedRepo} selected={selected} onToggle={toggleSelect} />

        ) : (
          <div className="flex items-center justify-center h-full text-[13px] text-[var(--color-text-dim)]">
            点击左侧技能查看详情
          </div>
        )}
      </div>
    </div>
  )
}

// ---- 已安装 Skill 详情 ----

function InstalledSkillDetail({ skill, onUpdated }: { skill: Skill; onUpdated: () => void }) {
  const [tab, setTab] = useState<'content' | 'refs' | 'scripts'>('content')
  const [expandedFile, setExpandedFile] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(skill.content)
  const [saving, setSaving] = useState(false)

  const refKeys = Object.keys(skill.references || {})
  const scriptKeys = Object.keys(skill.scripts || {})
  const meta = skill.metadata as Record<string, unknown> || {}
  const metaEntries = Object.entries(meta).filter(([k]) => !['name', 'description'].includes(k) && meta[k])

  useEffect(() => { setTab('content'); setExpandedFile(null); setEditing(false); setDraft(skill.content) }, [skill.name])

  const handleSave = async () => {
    setSaving(true)
    try { await updateSkill(skill.name, { content: draft }); setEditing(false); onUpdated() }
    catch { /* */ } finally { setSaving(false) }
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-3xl mx-auto px-6 md:px-10 py-8">
        {/* 标题 */}
        <div className="flex items-center justify-between mb-2">
          <h1 className="font-semibold text-[22px] text-[var(--color-text)]">{skill.name}</h1>
          {skill.type === 'installed' && (
            <span className="text-[11px] px-2 py-1 rounded-full bg-[var(--color-ok)]/10 text-[var(--color-ok)] border border-[var(--color-ok)]/20">已安装</span>
          )}
        </div>
        <p className="text-[13px] text-[var(--color-text-muted)] mb-3">{skill.description}</p>

        {/* 元数据 */}
        {metaEntries.length > 0 && (
          <div className="flex flex-wrap gap-x-4 gap-y-1.5 mb-4 text-[12px]">
            {metaEntries.map(([key, val]) => (
              <div key={key} className="flex items-center gap-1.5">
                <span className="text-[var(--color-text-dim)]">{key}:</span>
                <span className="text-[var(--color-text)]">{String(val)}</span>
              </div>
            ))}
          </div>
        )}

        {skill.source && (
          <div className="text-[11px] text-[var(--color-text-dim)] mb-4">{skill.source}</div>
        )}

        {/* Tab 栏 */}
        <div className="flex gap-1 mb-6 border-b border-[var(--color-border)]">
          <TabButton active={tab === 'content'} onClick={() => { setTab('content'); setExpandedFile(null) }}>概述</TabButton>
          {refKeys.length > 0 && (
            <TabButton active={tab === 'refs'} onClick={() => { setTab('refs'); setExpandedFile(refKeys.length === 1 ? refKeys[0] : null) }}>References ({refKeys.length})</TabButton>
          )}
          {scriptKeys.length > 0 && (
            <TabButton active={tab === 'scripts'} onClick={() => { setTab('scripts'); setExpandedFile(scriptKeys.length === 1 ? scriptKeys[0] : null) }}>Scripts ({scriptKeys.length})</TabButton>
          )}
        </div>

        {/* 概述 */}
        {tab === 'content' && (
          <div>
            {skill.type !== 'installed' && (
              <div className="flex justify-end mb-4">
                {!editing ? (
                  <button type="button" onClick={() => setEditing(true)} className="orca-btn-link text-[12px]">编辑</button>
                ) : null}
              </div>
            )}
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
        )}

        {/* References */}
        {tab === 'refs' && (
          <div className="space-y-2">
            {refKeys.map((name) => (
              <div key={name} className="rounded-lg border border-[var(--color-border)]">
                <button type="button"
                  onClick={() => setExpandedFile(expandedFile === name ? null : name)}
                  className="w-full flex items-center justify-between px-4 py-2.5 text-left hover:bg-[var(--color-surface-2)] transition-colors">
                  <span className="text-[13px] font-medium text-[var(--color-text)]">{name}</span>
                  <span className="text-[11px] text-[var(--color-text-dim)]">{expandedFile === name ? '▾' : '▸'}</span>
                </button>
                {expandedFile === name && (
                  <div className="border-t border-[var(--color-border)] px-4 py-3 orca-prose text-[13px]">
                    <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
                      {(skill.references || {})[name] || ''}
                    </ReactMarkdown>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Scripts */}
        {tab === 'scripts' && (
          <div className="space-y-2">
            {scriptKeys.map((name) => (
              <div key={name} className="rounded-lg border border-[var(--color-border)]">
                <button type="button"
                  onClick={() => setExpandedFile(expandedFile === name ? null : name)}
                  className="w-full flex items-center justify-between px-4 py-2.5 text-left hover:bg-[var(--color-surface-2)] transition-colors">
                  <span className="text-[13px] font-medium font-mono text-[var(--color-text)]">{name}</span>
                  <span className="text-[11px] text-[var(--color-text-dim)]">{expandedFile === name ? '▾' : '▸'}</span>
                </button>
                {expandedFile === name && (
                  <div className="border-t border-[var(--color-border)]">
                    <pre className="px-4 py-3 overflow-x-auto text-[12px] leading-relaxed bg-[var(--color-surface-2)]">
                      <code>{(skill.scripts || {})[name] || ''}</code>
                    </pre>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ---- Skill 预览面板 ----

function SkillPreview({ preview, scannedRepo, selected, onToggle }: {
  preview: DiscoveredSkill
  scannedRepo: string
  selected: Set<string>
  onToggle: (name: string, e: React.MouseEvent) => void
}) {
  const [previewTab, setPreviewTab] = useState<'content' | 'refs' | 'scripts'>('content')
  const [expandedFile, setExpandedFile] = useState<string | null>(null)

  const refKeys = Object.keys(preview.refs || {})
  const scriptKeys = Object.keys(preview.scripts || {})
  const fmEntries = Object.entries(preview.frontmatter || {}).filter(
    ([k]) => !['name', 'description'].includes(k)
  )

  useEffect(() => { setPreviewTab('content'); setExpandedFile(null) }, [preview.name])

  return (
    <div className="px-6 py-6 overflow-y-auto h-full">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-[18px] font-semibold text-[var(--color-text)]">{preview.name}</h2>
        {!preview.installed && !selected.has(preview.name) && (
          <button type="button" onClick={(e) => onToggle(preview.name, e)}
            className="orca-btn-primary text-[12px]">选择安装</button>
        )}
        {selected.has(preview.name) && (
          <span className="text-[11px] px-2 py-1 rounded-full bg-[var(--color-accent-soft)] text-[var(--color-accent)] border border-[var(--color-accent)]/20">已选中</span>
        )}
        {preview.installed && (
          <span className="text-[11px] px-2 py-1 rounded-full bg-[var(--color-ok)]/10 text-[var(--color-ok)] border border-[var(--color-ok)]/20">已安装</span>
        )}
      </div>

      {preview.description && (
        <p className="text-[13px] text-[var(--color-text-muted)] mb-3 leading-relaxed">{preview.description}</p>
      )}

      {fmEntries.length > 0 && (
        <div className="flex flex-wrap gap-x-4 gap-y-1.5 mb-4 text-[12px]">
          {fmEntries.map(([key, val]) => (
            <div key={key} className="flex items-center gap-1.5">
              <span className="text-[var(--color-text-dim)]">{key}:</span>
              {key === 'tags' ? (
                <div className="flex gap-1 flex-wrap">
                  {val.split(',').map((t: string) => t.trim()).filter(Boolean).map((tag: string) => (
                    <span key={tag} className="px-1.5 py-0.5 rounded bg-[var(--color-surface-2)] text-[var(--color-text-muted)] text-[10px]">{tag}</span>
                  ))}
                </div>
              ) : (
                <span className="text-[var(--color-text)]">{val}</span>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="text-[11px] text-[var(--color-text-dim)] mb-4">{scannedRepo}/{preview.path}</div>

      <div className="flex gap-1 mb-4 border-b border-[var(--color-border)]">
        <TabButton active={previewTab === 'content'} onClick={() => { setPreviewTab('content'); setExpandedFile(null) }}>概述</TabButton>
        {refKeys.length > 0 && (
          <TabButton active={previewTab === 'refs'} onClick={() => { setPreviewTab('refs'); setExpandedFile(refKeys.length === 1 ? refKeys[0] : null) }}>References ({refKeys.length})</TabButton>
        )}
        {scriptKeys.length > 0 && (
          <TabButton active={previewTab === 'scripts'} onClick={() => { setPreviewTab('scripts'); setExpandedFile(scriptKeys.length === 1 ? scriptKeys[0] : null) }}>Scripts ({scriptKeys.length})</TabButton>
        )}
      </div>

      {previewTab === 'content' && preview.content && (
        <div className="orca-prose">
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
            {preview.content}
          </ReactMarkdown>
        </div>
      )}

      {previewTab === 'refs' && (
        <div className="space-y-2">
          {refKeys.map((name) => (
            <div key={name} className="rounded-lg border border-[var(--color-border)]">
              <button type="button"
                onClick={() => setExpandedFile(expandedFile === name ? null : name)}
                className="w-full flex items-center justify-between px-4 py-2.5 text-left hover:bg-[var(--color-surface-2)] transition-colors">
                <span className="text-[13px] font-medium text-[var(--color-text)]">{name}</span>
                <span className="text-[11px] text-[var(--color-text-dim)]">{expandedFile === name ? '▾' : '▸'}</span>
              </button>
              {expandedFile === name && (
                <div className="border-t border-[var(--color-border)] px-4 py-3 orca-prose text-[13px]">
                  <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
                    {(preview.refs || {})[name] || ''}
                  </ReactMarkdown>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {previewTab === 'scripts' && (
        <div className="space-y-2">
          {scriptKeys.map((name) => (
            <div key={name} className="rounded-lg border border-[var(--color-border)]">
              <button type="button"
                onClick={() => setExpandedFile(expandedFile === name ? null : name)}
                className="w-full flex items-center justify-between px-4 py-2.5 text-left hover:bg-[var(--color-surface-2)] transition-colors">
                <span className="text-[13px] font-medium font-mono text-[var(--color-text)]">{name}</span>
                <span className="text-[11px] text-[var(--color-text-dim)]">{expandedFile === name ? '▾' : '▸'}</span>
              </button>
              {expandedFile === name && (
                <div className="border-t border-[var(--color-border)]">
                  <pre className="px-4 py-3 overflow-x-auto text-[12px] leading-relaxed bg-[var(--color-surface-2)]">
                    <code>{(preview.scripts || {})[name] || ''}</code>
                  </pre>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
