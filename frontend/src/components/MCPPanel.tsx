import { useEffect, useState, type FormEvent } from 'react'
import {
  listMCPConnections,
  createMCPConnection,
  deleteMCPConnection,
  reconnectMCPConnection,
  updateMCPConnection,
  getMCPOAuthURL,
  type MCPConnectionInfo,
  type MCPTransport,
} from '../api'

export function MCPPanel() {
  const [conns, setConns] = useState<MCPConnectionInfo[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [showAdd, setShowAdd] = useState(false)

  const reload = () => {
    listMCPConnections()
      .then((data) => { setConns(data); setErr(null) })
      .catch((e) => setErr(e.message))
  }

  useEffect(() => { reload() }, [])

  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.data?.type === 'orca-mcp-oauth-done') reload()
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [])

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-3xl mx-auto px-8 py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-[22px] font-semibold text-[var(--color-text)]">工具</h1>
            <p className="text-[13px] text-[var(--color-text-muted)] mt-1">
              连接外部 MCP Server，扩展 Agent 能力。
            </p>
          </div>
          <button type="button" onClick={() => setShowAdd(!showAdd)}
            className="h-8 px-3 rounded border border-[var(--color-border-strong)]
              bg-[var(--color-bg)] hover:bg-[var(--color-accent-soft)]
              hover:border-[var(--color-accent)]
              text-[13px] text-[var(--color-text)] font-mono transition-colors">
            + 添加
          </button>
        </div>

        {err && <div className="text-[13px] text-[var(--color-danger)] font-mono mb-4">{err}</div>}
        {showAdd && <AddConnectionForm onCreated={() => { setShowAdd(false); reload() }} />}

        {conns === null && !err && <div className="text-[12.5px] text-[var(--color-text-dim)] italic">加载中…</div>}
        {conns && conns.length === 0 && !showAdd && (
          <div className="py-6 text-center text-[13px] text-[var(--color-text-dim)]">
            还没有配置任何 MCP 连接。点击"+ 添加"开始。
          </div>
        )}
        {conns && conns.length > 0 && (
          <div className="space-y-2">
            {conns.map((conn) => (
              <ConnectionRow key={conn.id} conn={conn} onChanged={reload} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function ConnectionRow({ conn, onChanged }: { conn: MCPConnectionInfo; onChanged: () => void }) {
  const [expanded, setExpanded] = useState(false)
  const [busy, setBusy] = useState(false)

  const statusColor =
    conn.status === 'connected' ? 'var(--color-ok)' :
    conn.status === 'needs_auth' ? 'var(--color-warn)' :
    conn.status === 'disabled' ? 'var(--color-text-dim)' : 'var(--color-danger)'

  const statusText =
    conn.status === 'connected' ? `已连接 · ${conn.tools.length} 个工具` :
    conn.status === 'needs_auth' ? '需要授权' :
    conn.status === 'disabled' ? '已禁用' : '未连接'

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true); try { await fn(); onChanged() } catch { /* */ } finally { setBusy(false) }
  }

  return (
    <div className="rounded-md border border-[var(--color-border)]">
      <button type="button" onClick={() => setExpanded(!expanded)}
        className="w-full text-left px-4 py-3 hover:bg-[var(--color-surface)] transition-colors rounded-md">
        <div className="flex items-center gap-2 mb-1">
          <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: statusColor }} />
          <span className="text-[14px] text-[var(--color-text)] flex-1 truncate font-medium">{conn.name}</span>
          <span className="text-[11px] font-mono text-[var(--color-text-dim)] uppercase">{conn.transport}</span>
        </div>
        <div className="text-[11px] font-mono text-[var(--color-text-dim)]">{statusText}</div>
      </button>
      {expanded && (
        <div className="border-t border-[var(--color-border)] px-4 py-3 bg-[var(--color-surface)]/50 text-[12px] space-y-3">
          {conn.tools.length > 0 && (
            <div>
              <div className="text-[10.5px] font-mono uppercase tracking-[0.18em] text-[var(--color-text-dim)] mb-1.5">工具</div>
              <div className="flex flex-wrap gap-1.5">
                {conn.tools.map((t) => (
                  <span key={t} className="px-2 py-0.5 rounded border border-[var(--color-border)] text-[11px] font-mono text-[var(--color-text-muted)]">{t}</span>
                ))}
              </div>
            </div>
          )}
          <div className="text-[11px] font-mono text-[var(--color-text-dim)] space-y-0.5">
            {conn.url && <div>url: {conn.url}</div>}
            {conn.command && <div>cmd: {conn.command}</div>}
          </div>
          <div className="flex items-center gap-2">
            {conn.status === 'needs_auth' && <Btn onClick={() => act(async () => {
              const r = await getMCPOAuthURL(conn.id)
              if (r.authorize_url) window.open(r.authorize_url, 'orca-mcp-oauth', 'width=600,height=700')
            })} disabled={busy}>授权</Btn>}
            {conn.enabled && conn.status !== 'needs_auth' && <Btn onClick={() => act(() => reconnectMCPConnection(conn.id))} disabled={busy}>重连</Btn>}
            <Btn onClick={() => act(() => updateMCPConnection(conn.id, { enabled: !conn.enabled }))} disabled={busy}>{conn.enabled ? '禁用' : '启用'}</Btn>
            <Btn onClick={() => { if (confirm(`删除 "${conn.name}"？`)) act(() => deleteMCPConnection(conn.id)) }} disabled={busy} danger>删除</Btn>
          </div>
        </div>
      )}
    </div>
  )
}

function Btn({ onClick, disabled, danger, children }: { onClick: () => void; disabled?: boolean; danger?: boolean; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      className={`text-[11px] font-mono px-2 py-1 rounded border transition-colors disabled:opacity-50
        ${danger ? 'border-[var(--color-danger)]/40 text-[var(--color-danger)]' : 'border-[var(--color-border-strong)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface)]'}`}>
      {children}
    </button>
  )
}

const INPUT_CLS = `w-full px-2.5 py-1.5 rounded border border-[var(--color-border-strong)]
  bg-[var(--color-bg)] text-[13px] text-[var(--color-text)]
  focus:outline-none focus:border-[var(--color-text)]
  placeholder-[var(--color-text-dim)] font-mono transition-colors`

function AddConnectionForm({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [showAdv, setShowAdv] = useState(false)
  const [transport, setTransport] = useState<MCPTransport>('sse')
  const [command, setCommand] = useState('')
  const [args, setArgs] = useState('')
  const [authType, setAuthType] = useState('oauth')
  const [authToken, setAuthToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const isStdio = transport === 'stdio'

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setErr(null)
    try {
      await createMCPConnection({
        name, transport,
        command: isStdio ? command : undefined,
        args: isStdio && args ? args.split(/\s+/) : undefined,
        url: !isStdio ? url : undefined,
        auth_type: !isStdio ? authType as 'none' | 'bearer' | 'oauth' : undefined,
        auth_token: authType === 'bearer' ? authToken : undefined,
      })
      onCreated()
    } catch (e) { setErr(e instanceof Error ? e.message : '创建失败') }
    finally { setBusy(false) }
  }

  return (
    <form onSubmit={handleSubmit} className="mb-6 rounded-md border border-[var(--color-accent)]/40 bg-[var(--color-surface)]/50 p-4 space-y-3">
      {err && <div className="text-[12px] text-[var(--color-danger)] font-mono">{err}</div>}
      <label className="block">
        <span className="text-[11px] font-mono text-[var(--color-text-dim)] mb-1 block">名称 <span className="text-[var(--color-danger)]">*</span></span>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="cloudflare" className={INPUT_CLS} required />
      </label>
      {!isStdio && (
        <label className="block">
          <span className="text-[11px] font-mono text-[var(--color-text-dim)] mb-1 block">URL <span className="text-[var(--color-danger)]">*</span></span>
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://mcp.example.com/sse" className={INPUT_CLS} required />
        </label>
      )}
      {isStdio && (
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-[11px] font-mono text-[var(--color-text-dim)] mb-1 block">命令 <span className="text-[var(--color-danger)]">*</span></span>
            <input value={command} onChange={(e) => setCommand(e.target.value)} placeholder="npx" className={INPUT_CLS} required />
          </label>
          <label className="block">
            <span className="text-[11px] font-mono text-[var(--color-text-dim)] mb-1 block">参数</span>
            <input value={args} onChange={(e) => setArgs(e.target.value)} placeholder="-y @mcp/server" className={INPUT_CLS} />
          </label>
        </div>
      )}
      <button type="button" onClick={() => setShowAdv(!showAdv)}
        className="text-[12px] text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
        {showAdv ? '▾' : '▸'} 高级设置
      </button>
      {showAdv && (
        <div className="space-y-3 pl-3 border-l-2 border-[var(--color-border)]">
          <label className="block">
            <span className="text-[11px] font-mono text-[var(--color-text-dim)] mb-1 block">传输方式</span>
            <select value={transport} onChange={(e) => setTransport(e.target.value as MCPTransport)} className={INPUT_CLS}>
              <option value="sse">SSE（远程）</option>
              <option value="stdio">stdio（本地）</option>
            </select>
          </label>
          {!isStdio && (
            <label className="block">
              <span className="text-[11px] font-mono text-[var(--color-text-dim)] mb-1 block">认证</span>
              <select value={authType} onChange={(e) => setAuthType(e.target.value)} className={INPUT_CLS}>
                <option value="oauth">OAuth 2.1</option>
                <option value="bearer">Bearer Token</option>
                <option value="none">无</option>
              </select>
            </label>
          )}
          {authType === 'bearer' && (
            <label className="block">
              <span className="text-[11px] font-mono text-[var(--color-text-dim)] mb-1 block">Token</span>
              <input value={authToken} onChange={(e) => setAuthToken(e.target.value)} type="password" className={INPUT_CLS} />
            </label>
          )}
        </div>
      )}
      <div className="flex gap-2">
        <button type="submit" disabled={busy || !name || (isStdio ? !command : !url)}
          className="h-8 px-4 rounded bg-[var(--color-accent)] text-[var(--color-bg)]
            disabled:opacity-50 font-mono text-[11px] uppercase tracking-[0.15em]">
          {busy ? '添加中…' : '添加'}
        </button>
        <button type="button" onClick={onCreated}
          className="h-8 px-3 rounded border border-[var(--color-border-strong)]
            text-[var(--color-text-muted)] font-mono text-[11px]">取消</button>
      </div>
    </form>
  )
}
