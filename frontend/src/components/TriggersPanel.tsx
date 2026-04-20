import { useEffect, useState } from 'react'
import {
  listPlugins,
  enablePlugin,
  disablePlugin,
  regeneratePluginToken,
  getPluginToken,
  type PluginInfo,
} from '../api'

export function TriggersPanel() {
  const [plugins, setPlugins] = useState<PluginInfo[] | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const reload = () => {
    listPlugins().then(setPlugins).catch((e) => setErr(e.message))
  }

  useEffect(() => { reload() }, [])

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-3xl mx-auto px-8 py-8">
        <div className="mb-6">
          <div className="text-[10.5px] font-mono uppercase tracking-[0.2em] text-[var(--color-text-dim)] mb-1">
            trigger plugins
          </div>
          <h1 className="font-serif-display text-[28px] text-[var(--color-text)]">触发器</h1>
          <p className="text-[13px] text-[var(--color-text-muted)] mt-1">
            管理告警源 Webhook 插件。启用后会生成 Webhook URL 和 Secret Token，
            配置到告警源（如 UptimeKuma）的通知设置中。
          </p>
        </div>

        {err && <div className="text-[13px] text-[var(--color-danger)] font-mono mb-4">{err}</div>}

        {plugins === null && !err && (
          <div className="text-[12.5px] text-[var(--color-text-dim)] italic">加载中…</div>
        )}

        {plugins && plugins.length === 0 && (
          <div className="text-[13px] text-[var(--color-text-dim)]">没有可用的触发器插件。</div>
        )}

        {plugins && plugins.length > 0 && (
          <div className="space-y-3">
            {plugins.map((p) => (
              <PluginRow key={p.name} plugin={p} onChanged={reload} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function PluginRow({ plugin, onChanged }: { plugin: PluginInfo; onChanged: () => void }) {
  const [expanded, setExpanded] = useState(false)
  const [token, setToken] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const handleToggle = async () => {
    setBusy(true)
    try {
      if (plugin.enabled) await disablePlugin(plugin.name)
      else await enablePlugin(plugin.name)
      onChanged()
    } catch { /* */ } finally { setBusy(false) }
  }

  const handleExpand = async () => {
    if (!expanded && token === null) {
      const info = await getPluginToken(plugin.name).catch(() => null)
      if (info) setToken(info.secret_token)
    }
    setExpanded(!expanded)
  }

  const handleRegenerate = async () => {
    setBusy(true)
    try {
      const info = await regeneratePluginToken(plugin.name)
      setToken(info.secret_token)
    } catch { /* */ } finally { setBusy(false) }
  }

  return (
    <div className="rounded-md border border-[var(--color-border)]">
      <button type="button" onClick={handleExpand}
        className="w-full text-left px-4 py-3 hover:bg-[var(--color-surface)] transition-colors rounded-md">
        <div className="flex items-center gap-3">
          <span className={`w-2 h-2 rounded-full ${plugin.enabled ? 'bg-[var(--color-ok)]' : 'bg-[var(--color-text-dim)]'}`} />
          <div className="flex-1">
            <div className="text-[14px] text-[var(--color-text)] font-medium">{plugin.name}</div>
            <div className="text-[12px] text-[var(--color-text-dim)]">{plugin.description}</div>
          </div>
          <span className="text-[11px] font-mono text-[var(--color-text-dim)]">
            {plugin.enabled ? '启用' : '停用'}
          </span>
        </div>
      </button>

      {expanded && (
        <div className="border-t border-[var(--color-border)] px-4 py-3 bg-[var(--color-surface)]/50 space-y-3 text-[12px]">
          {plugin.webhook_url && (
            <div>
              <span className="font-mono text-[var(--color-text-dim)]">Webhook URL</span>
              <div className="mt-1 px-2 py-1.5 rounded bg-[var(--color-bg)] border border-[var(--color-border)]
                font-mono text-[11.5px] text-[var(--color-text)] break-all select-all">
                {plugin.webhook_url}
              </div>
            </div>
          )}
          {token && (
            <div>
              <span className="font-mono text-[var(--color-text-dim)]">Secret Token</span>
              <div className="mt-1 px-2 py-1.5 rounded bg-[var(--color-bg)] border border-[var(--color-border)]
                font-mono text-[11.5px] text-[var(--color-text)] break-all select-all">
                {token}
              </div>
            </div>
          )}
          <div className="flex items-center gap-2 pt-1">
            <ActionBtn onClick={handleToggle} disabled={busy}>
              {plugin.enabled ? '停用' : '启用'}
            </ActionBtn>
            {plugin.enabled && (
              <ActionBtn onClick={handleRegenerate} disabled={busy}>重新生成 Token</ActionBtn>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function ActionBtn({ onClick, disabled, children }: {
  onClick: () => void; disabled?: boolean; children: React.ReactNode
}) {
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      className="text-[11px] font-mono px-2 py-1 rounded border
        border-[var(--color-border-strong)] text-[var(--color-text-muted)]
        hover:bg-[var(--color-surface)] disabled:opacity-50 transition-colors">
      {children}
    </button>
  )
}
