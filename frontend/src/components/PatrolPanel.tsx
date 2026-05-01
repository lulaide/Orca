import { useEffect, useMemo, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  getPatrol,
  updatePatrol,
  deletePatrol,
  runPatrol,
  createPatrol,
  listPatrolRuns,
  getConversationMessages,
  forkConversation,
  type PatrolConfig,
  type PatrolRun,
  type ChatMessage,
} from '../api'
import { navigate } from '../navigate'
import { ToolCallCard } from './ToolCallCard'
import { InvestigationRefCard } from './InvestigationRefCard'
import { formatRelativeTime } from '../timeFormat'

// 从报告中提取摘要行，回退到前 100 字符
function extractBrief(summary: string): string {
  for (const line of summary.split('\n')) {
    const trimmed = line.trim()
    if (trimmed.startsWith('**摘要**：') || trimmed.startsWith('**摘要**:')) {
      return trimmed.replace(/^\*\*摘要\*\*[：:]/, '').trim()
    }
  }
  // 没有摘要行，取第一行非空非标题的文字
  for (const line of summary.split('\n')) {
    const trimmed = line.trim()
    if (trimmed && !trimmed.startsWith('#') && !trimmed.startsWith('---') && !trimmed.startsWith('**详情**')) {
      return trimmed.length > 100 ? trimmed.slice(0, 100) + '…' : trimmed
    }
  }
  return summary.slice(0, 100)
}

export function PatrolPanel() {
  const [patrol, setPatrol] = useState<PatrolConfig | null>(null)
  const [runs, setRuns] = useState<PatrolRun[]>([])
  const [editing, setEditing] = useState(false)
  const [creating, setCreating] = useState(false)

  // 从 URL 读取当前巡检 ID
  useEffect(() => {
    const path = window.location.pathname
    if (path.startsWith('/patrol/')) {
      const id = path.slice('/patrol/'.length)
      if (id) loadPatrol(id)
    }
  }, [window.location.pathname])

  useEffect(() => {
    const onPop = () => {
      const path = window.location.pathname
      if (path.startsWith('/patrol/')) {
        loadPatrol(path.slice('/patrol/'.length))
      } else {
        setPatrol(null)
      }
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const loadPatrol = (id: string) => {
    getPatrol(id).then((p) => {
      setPatrol(p)
      setEditing(false)
      setCreating(false)
      listPatrolRuns(id).then(setRuns).catch(() => {})
    }).catch(() => setPatrol(null))
  }

  const handleToggleEnabled = async () => {
    if (!patrol) return
    const updated = await updatePatrol(patrol.id, { enabled: !patrol.enabled })
    setPatrol(updated)
  }

  const handleRun = async () => {
    if (!patrol) return
    await runPatrol(patrol.id)
    // 刷新运行历史
    setTimeout(() => listPatrolRuns(patrol.id).then(setRuns).catch(() => {}), 1000)
  }

  const handleDelete = async () => {
    if (!patrol || !confirm(`删除巡检 "${patrol.name}"？`)) return
    await deletePatrol(patrol.id)
    setPatrol(null)
    navigate('/patrol')
  }

  if (creating) {
    return <CreatePatrolForm onCreated={(p) => { setCreating(false); navigate(`/patrol/${p.id}`) }} onCancel={() => setCreating(false)} />
  }

  if (!patrol) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4">
        <p className="text-[13px] text-[var(--color-text-dim)]">选择左侧巡检任务查看详情</p>
        <button type="button" onClick={() => setCreating(true)} className="orca-btn-primary text-[13px]">
          + 新建巡检
        </button>
      </div>
    )
  }

  if (editing) {
    return <EditPatrolForm patrol={patrol} onSaved={(p) => { setPatrol(p); setEditing(false) }} onCancel={() => setEditing(false)} />
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-3xl mx-auto px-6 md:px-10 py-8">
        {/* 标题栏 */}
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-[22px] font-semibold text-[var(--color-text)]">{patrol.name}</h1>
          <div className="flex items-center gap-2">
            <button type="button" onClick={handleRun} className="orca-btn-primary text-[12px]">
              立即执行
            </button>
            <button type="button" onClick={() => setEditing(true)} className="orca-btn-secondary text-[12px]">
              编辑
            </button>
            <button type="button" onClick={handleDelete} className="orca-btn-danger text-[12px]">
              删除
            </button>
          </div>
        </div>

        {/* 信息区 */}
        <div className="flex flex-wrap gap-x-6 gap-y-2 mb-6 text-[13px]">
          <div className="flex items-center gap-2">
            <span className="text-[var(--color-text-dim)]">状态</span>
            <button type="button" onClick={handleToggleEnabled}
              className={`px-2 py-0.5 rounded-full text-[11px] font-medium border ${
                patrol.enabled
                  ? 'bg-[var(--color-ok)]/10 text-[var(--color-ok)] border-[var(--color-ok)]/20'
                  : 'bg-[var(--color-surface-2)] text-[var(--color-text-dim)] border-[var(--color-border)]'
              }`}>
              {patrol.enabled ? '启用' : '禁用'}
            </button>
          </div>
          <div><span className="text-[var(--color-text-dim)]">Cron</span> <span className="font-mono text-[var(--color-text)]">{patrol.schedule}</span></div>
          <div><span className="text-[var(--color-text-dim)]">严重度</span> <span className="text-[var(--color-text)]">{patrol.severity}</span></div>
          {patrol.last_run_at && (
            <div><span className="text-[var(--color-text-dim)]">上次运行</span> <span className="text-[var(--color-text)]">{formatRelativeTime(patrol.last_run_at)}</span></div>
          )}
        </div>

        {/* Prompt */}
        <div className="mb-8">
          <h2 className="text-[15px] font-semibold text-[var(--color-text)] mb-3">巡检指令</h2>
          <div className="px-4 py-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] text-[13px] text-[var(--color-text)] whitespace-pre-wrap leading-relaxed">
            {patrol.prompt}
          </div>
        </div>

        {/* 运行历史 */}
        <h2 className="text-[15px] font-semibold text-[var(--color-text)] mb-3">运行历史</h2>
        {runs.length === 0 ? (
          <p className="text-[13px] text-[var(--color-text-dim)]">暂无运行记录</p>
        ) : (
          <div className="space-y-2">
            {runs.map((r) => (
              <div key={r.id} className="rounded-lg border border-[var(--color-border)] px-4 py-3 text-[13px]">
                <div className="flex items-center gap-3 mb-1">
                  <span className={`w-2 h-2 rounded-full shrink-0 ${
                    r.status === 'completed' ? 'bg-[var(--color-ok)]' :
                    r.status === 'running' ? 'bg-[var(--color-accent)] animate-pulse' :
                    'bg-[var(--color-danger)]'
                  }`} />
                  <span className="text-[var(--color-text)]">{formatRelativeTime(r.created_at)}</span>
                  <span className={`px-1.5 py-0.5 rounded text-[11px] ${
                    r.status === 'completed' ? 'bg-[var(--color-ok)]/10 text-[var(--color-ok)]' :
                    r.status === 'running' ? 'bg-[var(--color-accent-soft)] text-[var(--color-accent)]' :
                    'bg-[var(--color-danger)]/10 text-[var(--color-danger)]'
                  }`}>{r.status === 'completed' ? '完成' : r.status === 'running' ? '运行中' : '失败'}</span>
                  {r.duration > 0 && <span className="text-[var(--color-text-dim)]">{r.duration}s</span>}
                </div>
                {r.summary && (
                  <p className="text-[12px] text-[var(--color-text-muted)] mt-1 line-clamp-2">
                    {extractBrief(r.summary)}
                  </p>
                )}
                {r.error && <p className="text-[12px] text-[var(--color-danger)] mt-1">{r.error}</p>}
                {r.conversation_id && r.status === 'completed' && (
                  <RunDetail conversationId={r.conversation_id} />
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ---- 创建表单 ----

function CreatePatrolForm({ onCreated, onCancel }: { onCreated: (p: PatrolConfig) => void; onCancel: () => void }) {
  const [name, setName] = useState('')
  const [schedule, setSchedule] = useState('0 */6 * * *')
  const [prompt, setPrompt] = useState('')
  const [severity, setSeverity] = useState('warning')
  const [busy, setBusy] = useState(false)

  const handleSubmit = async () => {
    setBusy(true)
    try {
      const p = await createPatrol({ name, schedule, prompt, severity })
      onCreated(p)
    } catch { /* */ }
    setBusy(false)
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-2xl mx-auto px-6 md:px-10 py-8">
        <h1 className="text-[20px] font-semibold text-[var(--color-text)] mb-6">新建巡检</h1>
        <PatrolForm
          name={name} schedule={schedule} prompt={prompt} severity={severity}
          onNameChange={setName} onScheduleChange={setSchedule} onPromptChange={setPrompt} onSeverityChange={setSeverity}
        />
        <div className="flex gap-2 mt-4">
          <button type="button" onClick={handleSubmit} disabled={busy || !name || !schedule || !prompt}
            className="orca-btn-primary">{busy ? '创建中…' : '创建'}</button>
          <button type="button" onClick={onCancel} className="orca-btn-secondary">取消</button>
        </div>
      </div>
    </div>
  )
}

// ---- 编辑表单 ----

function EditPatrolForm({ patrol, onSaved, onCancel }: { patrol: PatrolConfig; onSaved: (p: PatrolConfig) => void; onCancel: () => void }) {
  const [name, setName] = useState(patrol.name)
  const [schedule, setSchedule] = useState(patrol.schedule)
  const [prompt, setPrompt] = useState(patrol.prompt)
  const [severity, setSeverity] = useState(patrol.severity)
  const [busy, setBusy] = useState(false)

  const handleSubmit = async () => {
    setBusy(true)
    try {
      const p = await updatePatrol(patrol.id, { name, schedule, prompt, severity })
      onSaved(p)
    } catch { /* */ }
    setBusy(false)
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-2xl mx-auto px-6 md:px-10 py-8">
        <h1 className="text-[20px] font-semibold text-[var(--color-text)] mb-6">编辑巡检</h1>
        <PatrolForm
          name={name} schedule={schedule} prompt={prompt} severity={severity}
          onNameChange={setName} onScheduleChange={setSchedule} onPromptChange={setPrompt} onSeverityChange={setSeverity}
        />
        <div className="flex gap-2 mt-4">
          <button type="button" onClick={handleSubmit} disabled={busy || !name || !schedule || !prompt}
            className="orca-btn-primary">{busy ? '保存中…' : '保存'}</button>
          <button type="button" onClick={onCancel} className="orca-btn-secondary">取消</button>
        </div>
      </div>
    </div>
  )
}

// ---- 共用表单字段 ----

function PatrolForm({ name, schedule, prompt, severity, onNameChange, onScheduleChange, onPromptChange, onSeverityChange }: {
  name: string; schedule: string; prompt: string; severity: string
  onNameChange: (v: string) => void; onScheduleChange: (v: string) => void
  onPromptChange: (v: string) => void; onSeverityChange: (v: string) => void
}) {
  const INPUT_CLS = "w-full px-3 py-2 rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-bg)] text-[13px] text-[var(--color-text)] focus:border-[var(--color-accent)] focus:outline-none"

  return (
    <div className="space-y-4">
      <label className="block">
        <span className="text-[12px] font-medium text-[var(--color-text-dim)] mb-1 block">名称</span>
        <input value={name} onChange={(e) => onNameChange(e.target.value)} placeholder="集群健康检查" className={INPUT_CLS} />
      </label>
      <div className="grid grid-cols-2 gap-4">
        <label className="block">
          <span className="text-[12px] font-medium text-[var(--color-text-dim)] mb-1 block">Cron 表达式</span>
          <input value={schedule} onChange={(e) => onScheduleChange(e.target.value)} placeholder="0 */6 * * *" className={INPUT_CLS + ' font-mono'} />
          <span className="text-[11px] text-[var(--color-text-dim)] mt-1 block">每6小时: 0 */6 * * * · 每天9点: 0 9 * * * · 每小时: 0 * * * *</span>
        </label>
        <label className="block">
          <span className="text-[12px] font-medium text-[var(--color-text-dim)] mb-1 block">严重度</span>
          <select value={severity} onChange={(e) => onSeverityChange(e.target.value)} className={INPUT_CLS}>
            <option value="info">信息</option>
            <option value="warning">警告</option>
            <option value="critical">严重</option>
          </select>
        </label>
      </div>
      <label className="block">
        <span className="text-[12px] font-medium text-[var(--color-text-dim)] mb-1 block">巡检指令</span>
        <textarea value={prompt} onChange={(e) => onPromptChange(e.target.value)} rows={8}
          placeholder="检查集群整体健康状态：&#10;1. 所有节点是否 Ready&#10;2. 是否有异常 Pod&#10;..."
          className={INPUT_CLS + ' resize-y leading-relaxed'} />
      </label>
    </div>
  )
}

// ---- 运行详情（平铺式，和事件详情一致） ----

function RunDetail({ conversationId }: { conversationId: string }) {
  const [expanded, setExpanded] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[] | null>(null)

  useEffect(() => {
    if (!expanded) return
    getConversationMessages(conversationId).then(setMessages).catch(() => setMessages([]))
  }, [expanded, conversationId])

  const toolOutputs = useMemo(() => {
    const map: Record<string, string> = {}
    if (!messages) return map
    for (const m of messages) {
      if (m.role === 'tool' && m.tool_call_id) map[m.tool_call_id] = m.content
    }
    return map
  }, [messages])

  const assistantMessages = useMemo(() => {
    if (!messages) return []
    return messages.filter((m) => m.role === 'assistant')
  }, [messages])

  if (!expanded) {
    return (
      <button type="button" onClick={() => setExpanded(true)}
        className="orca-btn-secondary text-[12px] mt-2">
        查看详细过程
      </button>
    )
  }

  return (
    <div className="mt-3 border-t border-[var(--color-border)] pt-3">
      <div className="flex items-center justify-between mb-3">
        <button type="button" onClick={() => setExpanded(false)}
          className="orca-btn-secondary text-[12px]">
          收起
        </button>
        <button type="button" onClick={async () => {
          try {
            const conv = await forkConversation(conversationId)
            navigate(`/c/${conv.id}`)
          } catch { /* */ }
        }} className="orca-btn-secondary text-[12px]">
          继续对话 →
        </button>
      </div>

      {messages === null && (
        <div className="text-[12px] text-[var(--color-text-dim)]">加载中…</div>
      )}

      {assistantMessages.length > 0 && (
        <div className="space-y-3">
          {assistantMessages.map((m) => (
            <div key={m.id}>
              {m.content && (
                <div className="orca-prose text-[13px] mb-1.5">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown>
                </div>
              )}
              {m.tool_calls && m.tool_calls.length > 0 && (
                <div className="space-y-1">
                  {m.tool_calls.map((tc) =>
                    tc.function.name === 'create_investigation' ? (
                      <InvestigationRefCard key={tc.id} toolCall={tc} output={toolOutputs[tc.id]} />
                    ) : (
                      <ToolCallCard key={tc.id} toolCall={tc} output={toolOutputs[tc.id]} />
                    ),
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
