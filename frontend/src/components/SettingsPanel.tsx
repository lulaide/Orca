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

interface Props {
  refreshToken: number
}

export function SettingsPanel({ refreshToken }: Props) {
  const [conns, setConns] = useState<MCPConnectionInfo[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [showAdd, setShowAdd] = useState(false)

  const reload = () => {
    listMCPConnections()
      .then((data) => { setConns(data); setErr(null) })
      .catch((e) => setErr(e.message))
  }

  useEffect(() => { reload() }, [refreshToken])

  // 监听 OAuth 弹窗回调
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.data?.type === 'orca-mcp-oauth-done') reload()
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [])

  return (
    <div className="flex flex-col flex-1 min-h-0 h-full">
      <header className="flex items-center justify-between px-6 h-11 border-b border-[var(--color-border)] bg-[var(--color-bg)] font-mono text-[11px]">
        <div className="flex items-center gap-2 text-[var(--color-text-dim)]">
          <span className="text-[var(--color-accent)]">~</span>
          <span>/</span>
          <span>orca</span>
          <span>/</span>
          <span className="text-[var(--color-text-muted)]">settings</span>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto orca-grid">
        <div className="max-w-3xl mx-auto px-6 py-8">
          <div className="flex items-center justify-between mb-6">
            <div>
              <div className="text-[10.5px] font-mono uppercase tracking-[0.2em] text-[var(--color-text-dim)] mb-1">
                mcp connections
              </div>
              <h1 className="font-serif-display text-[28px] leading-tight text-[var(--color-text)]">
                外部工具连接
              </h1>
              <p className="text-[13px] text-[var(--color-text-muted)] mt-1">
                连接外部 MCP Server，让 Agent 获得更多工具能力。
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowAdd(!showAdd)}
              className="h-8 px-3 rounded border border-[var(--color-border-strong)]
                bg-[var(--color-bg)] hover:bg-[var(--color-accent-soft)]
                hover:border-[var(--color-accent)]
                text-[13px] text-[var(--color-text)] font-mono transition-colors"
            >
              + 添加
            </button>
          </div>

          {err && (
            <div className="text-[13px] text-[var(--color-danger)] font-mono mb-4">{err}</div>
          )}

          {showAdd && <AddConnectionForm onCreated={() => { setShowAdd(false); reload() }} />}

          {conns === null && !err && (
            <div className="text-[12.5px] text-[var(--color-text-dim)] italic">加载中…</div>
          )}
          {conns && conns.length === 0 && !showAdd && (
            <div className="py-10 text-center">
              <div className="text-[13px] text-[var(--color-text-dim)]">
                还没有配置任何 MCP 连接。点击"+ 添加"开始。
              </div>
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
    </div>
  )
}

function ConnectionRow({ conn, onChanged }: { conn: MCPConnectionInfo; onChanged: () => void }) {
  const [expanded, setExpanded] = useState(false)
  const [busy, setBusy] = useState(false)

  const statusColor =
    conn.status === 'connected' ? 'var(--color-ok)' :
    conn.status === 'needs_auth' ? 'var(--color-warn)' :
    conn.status === 'disabled' ? 'var(--color-text-dim)' :
    'var(--color-danger)'

  const statusText =
    conn.status === 'connected' ? `已连接 · ${conn.tools.length} 个工具` :
    conn.status === 'needs_auth' ? '需要授权' :
    conn.status === 'disabled' ? '已禁用' :
    '未连接'

  const handleToggle = async () => {
    setBusy(true)
    try {
      await updateMCPConnection(conn.id, { enabled: !conn.enabled })
      onChanged()
    } catch { /* */ } finally { setBusy(false) }
  }

  const handleReconnect = async () => {
    setBusy(true)
    try {
      await reconnectMCPConnection(conn.id)
      onChanged()
    } catch { /* */ } finally { setBusy(false) }
  }

  const handleDelete = async () => {
    if (!confirm(`确定删除连接 "${conn.name}"？`)) return
    setBusy(true)
    try {
      await deleteMCPConnection(conn.id)
      onChanged()
    } catch { /* */ } finally { setBusy(false) }
  }

  const handleOAuth = async () => {
    setBusy(true)
    try {
      const result = await getMCPOAuthURL(conn.id)
      if (result.authorize_url) {
        window.open(result.authorize_url, 'orca-mcp-oauth', 'width=600,height=700')
      } else {
        onChanged() // already authorized
      }
    } catch { /* */ } finally { setBusy(false) }
  }

  return (
    <div className="rounded-md border border-[var(--color-border)] hover:border-[var(--color-border-strong)] transition-colors">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full text-left px-4 py-3 hover:bg-[var(--color-surface)] transition-colors rounded-md"
      >
        <div className="flex items-center gap-2 mb-1">
          <span
            className="w-2 h-2 rounded-full shrink-0"
            style={{ backgroundColor: statusColor }}
          />
          <span className="font-serif-display text-[17px] text-[var(--color-text)] flex-1 truncate">
            {conn.name}
          </span>
          <span className="text-[11px] font-mono text-[var(--color-text-dim)] uppercase tracking-[0.12em]">
            {conn.transport}
          </span>
        </div>
        <div className="flex items-center gap-3 text-[11px] font-mono text-[var(--color-text-dim)]">
          <span>{statusText}</span>
          {conn.description && <span className="truncate">· {conn.description}</span>}
        </div>
      </button>

      {expanded && (
        <div className="border-t border-[var(--color-border)] px-4 py-3 bg-[var(--color-surface)]/50 text-[12px] space-y-3">
          {/* 工具列表 */}
          {conn.tools.length > 0 && (
            <div>
              <div className="text-[10.5px] font-mono uppercase tracking-[0.18em] text-[var(--color-text-dim)] mb-1.5">
                已发现工具
              </div>
              <div className="flex flex-wrap gap-1.5">
                {conn.tools.map((t) => (
                  <span key={t} className="px-2 py-0.5 rounded border border-[var(--color-border)]
                    text-[11px] font-mono text-[var(--color-text-muted)]">
                    {t}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* 配置详情 */}
          <div className="text-[11px] font-mono text-[var(--color-text-dim)] space-y-0.5">
            {conn.transport === 'stdio' && conn.command && (
              <div>command: {conn.command} {(conn.args ?? []).join(' ')}</div>
            )}
            {conn.transport === 'sse' && conn.url && (
              <div>url: {conn.url}</div>
            )}
            {conn.auth_type && conn.auth_type !== 'none' && (
              <div>auth: {conn.auth_type}</div>
            )}
          </div>

          {/* 操作按钮 */}
          <div className="flex items-center gap-2 pt-1">
            {conn.status === 'needs_auth' && (
              <ActionBtn onClick={handleOAuth} disabled={busy}>授权</ActionBtn>
            )}
            {conn.enabled && conn.status !== 'needs_auth' && (
              <ActionBtn onClick={handleReconnect} disabled={busy}>重连</ActionBtn>
            )}
            <ActionBtn onClick={handleToggle} disabled={busy}>
              {conn.enabled ? '禁用' : '启用'}
            </ActionBtn>
            <ActionBtn onClick={handleDelete} disabled={busy} danger>
              删除
            </ActionBtn>
          </div>
        </div>
      )}
    </div>
  )
}

function ActionBtn({ onClick, disabled, danger, children }: {
  onClick: () => void
  disabled?: boolean
  danger?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`text-[11px] font-mono px-2 py-1 rounded border transition-colors
        disabled:opacity-50 disabled:cursor-not-allowed
        ${danger
          ? 'border-[var(--color-danger)]/40 text-[var(--color-danger)] hover:bg-[var(--color-danger)]/10'
          : 'border-[var(--color-border-strong)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface)]'
        }`}
    >
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
  const [showAdvanced, setShowAdvanced] = useState(false)
  // 高级设置
  const [transport, setTransport] = useState<MCPTransport>('sse')
  const [command, setCommand] = useState('')
  const [args, setArgs] = useState('')
  const [authType, setAuthType] = useState('oauth')
  const [authToken, setAuthToken] = useState('')
  const [oauthClientId, setOauthClientId] = useState('')
  const [oauthScopes, setOauthScopes] = useState('')
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const isStdio = transport === 'stdio'

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setErr(null)
    try {
      await createMCPConnection({
        name,
        transport,
        command: isStdio ? command : undefined,
        args: isStdio && args ? args.split(/\s+/) : undefined,
        url: !isStdio ? url : undefined,
        auth_type: !isStdio ? authType as 'none' | 'bearer' | 'oauth' : undefined,
        auth_token: authType === 'bearer' ? authToken : undefined,
        oauth_client_id: authType === 'oauth' && oauthClientId ? oauthClientId : undefined,
        oauth_scopes: authType === 'oauth' && oauthScopes ? oauthScopes : undefined,
        description: description || undefined,
      })
      onCreated()
    } catch (e) {
      setErr(e instanceof Error ? e.message : '创建失败')
    } finally { setBusy(false) }
  }

  const canSubmit = name && (isStdio ? !!command : !!url)

  return (
    <form onSubmit={handleSubmit} className="mb-6 rounded-md border border-[var(--color-accent)]/40 bg-[var(--color-surface)]/50 p-4 space-y-3">
      <div className="text-[11px] font-mono uppercase tracking-[0.18em] text-[var(--color-accent)] mb-2">
        添加 MCP 连接
      </div>

      {err && <div className="text-[12px] text-[var(--color-danger)] font-mono">{err}</div>}

      {/* 主要字段 — Name + URL，和 Claude 一样简洁 */}
      <Field label="名称" required>
        <input value={name} onChange={(e) => setName(e.target.value)}
          placeholder="如 cloudflare" className={INPUT_CLS} required />
      </Field>

      {!isStdio && (
        <Field label="远程 MCP Server URL" required>
          <input value={url} onChange={(e) => setUrl(e.target.value)}
            placeholder="https://mcp.cloudflare.com/sse" className={INPUT_CLS} required />
        </Field>
      )}

      {isStdio && (
        <div className="grid grid-cols-2 gap-3">
          <Field label="命令" required>
            <input value={command} onChange={(e) => setCommand(e.target.value)}
              placeholder="npx" className={INPUT_CLS} required />
          </Field>
          <Field label="参数（空格分隔）">
            <input value={args} onChange={(e) => setArgs(e.target.value)}
              placeholder="-y @modelcontextprotocol/server-filesystem /tmp"
              className={INPUT_CLS} />
          </Field>
        </div>
      )}

      {/* 高级设置 */}
      <button
        type="button"
        onClick={() => setShowAdvanced(!showAdvanced)}
        className="text-[12px] text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
      >
        {showAdvanced ? '▾' : '▸'} 高级设置
      </button>

      {showAdvanced && (
        <div className="space-y-3 pl-3 border-l-2 border-[var(--color-border)]">
          <Field label="传输方式">
            <select value={transport} onChange={(e) => setTransport(e.target.value as MCPTransport)}
              className={INPUT_CLS}>
              <option value="sse">SSE（远程服务）</option>
              <option value="stdio">stdio（本地子进程）</option>
            </select>
          </Field>

          {!isStdio && (
            <Field label="认证方式">
              <select value={authType} onChange={(e) => setAuthType(e.target.value)}
                className={INPUT_CLS}>
                <option value="oauth">OAuth 2.1（浏览器授权，默认）</option>
                <option value="bearer">Bearer Token（手动粘贴）</option>
                <option value="none">无认证</option>
              </select>
            </Field>
          )}

          {!isStdio && authType === 'bearer' && (
            <Field label="Bearer Token">
              <input value={authToken} onChange={(e) => setAuthToken(e.target.value)}
                type="password" placeholder="sk-..." className={INPUT_CLS} />
            </Field>
          )}

          {!isStdio && authType === 'oauth' && (
            <>
              <Field label="Client ID（可选，留空则自动注册）">
                <input value={oauthClientId} onChange={(e) => setOauthClientId(e.target.value)}
                  placeholder="留空 = 动态注册" className={INPUT_CLS} />
              </Field>
              <Field label="Scopes（可选，空格分隔）">
                <input value={oauthScopes} onChange={(e) => setOauthScopes(e.target.value)}
                  placeholder="" className={INPUT_CLS} />
              </Field>
            </>
          )}

          <Field label="描述">
            <input value={description} onChange={(e) => setDescription(e.target.value)}
              placeholder="Cloudflare DNS 管理" className={INPUT_CLS} />
          </Field>
        </div>
      )}

      <div className="flex items-center gap-2 pt-1">
        <button
          type="submit"
          disabled={busy || !canSubmit}
          className="h-8 px-4 rounded bg-[var(--color-accent)] text-[var(--color-bg)]
            hover:bg-[var(--color-accent-hover)]
            disabled:opacity-50 disabled:cursor-not-allowed
            font-mono text-[11px] uppercase tracking-[0.15em] transition-colors"
        >
          {busy ? '添加中…' : '添加'}
        </button>
        <button
          type="button"
          onClick={onCreated}
          className="h-8 px-3 rounded border border-[var(--color-border-strong)]
            text-[var(--color-text-muted)] hover:bg-[var(--color-surface)]
            font-mono text-[11px] transition-colors"
        >
          取消
        </button>
      </div>
    </form>
  )
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[11px] font-mono text-[var(--color-text-dim)] mb-1 block">
        {label}{required && <span className="text-[var(--color-danger)]"> *</span>}
      </span>
      {children}
    </label>
  )
}
