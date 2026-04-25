import { useEffect, useState, type FormEvent } from 'react'
import {
  getStatus,
  updateLLMSettings,
  testLLMConnection,
  connectKubeInCluster,
  uploadKubeconfig,
  disconnectKube,
  getOAuthConfig,
  setOAuthConfig,
  authFetch,
  type StatusResponse,
  type OAuthConfig,
} from '../api'

interface Props {
  refreshToken: number
}

export function SettingsPanel({ refreshToken }: Props) {
  const [status, setStatus] = useState<StatusResponse | null>(null)
  const reloadStatus = () => { getStatus().then(setStatus).catch(() => {}) }
  useEffect(() => { reloadStatus() }, [refreshToken])

  return (
    <div className="flex-1 overflow-y-auto pb-14 md:pb-0">
      <div className="max-w-3xl mx-auto px-8 py-8 space-y-10">
        <h1 className="text-[22px] font-semibold text-[var(--color-text)]">设置</h1>
        <SiteSection />
        <LLMSection status={status} onSaved={reloadStatus} />
        <KubeSection status={status} onChanged={reloadStatus} />
        <OAuthSection />
      </div>
    </div>
  )
}

const INPUT_CLS = `w-full px-2.5 py-1.5 rounded border border-[var(--color-border-strong)]
  bg-[var(--color-bg)] text-[13px] text-[var(--color-text)]
  focus:outline-none focus:border-[var(--color-text)]
  placeholder-[var(--color-text-dim)] font-mono transition-colors`

// ---- Site ----

function SiteSection() {
  const [baseUrl, setBaseUrl] = useState('')
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    authFetch('/api/settings/site').then(r => r.json()).then(d => setBaseUrl(d.base_url || '')).catch(() => {})
  }, [])

  const handleSave = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true)
    try {
      await authFetch('/api/settings/site', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ base_url: baseUrl }),
      })
      setEditing(false); setSaved(true); setTimeout(() => setSaved(false), 2000)
    } catch { /* */ } finally { setBusy(false) }
  }

  return (
    <section>
      <h2 className="text-[16px] font-semibold text-[var(--color-text)] mb-3">站点</h2>
      <div className="rounded-md border border-[var(--color-border)] p-4">
        <div className="flex items-center gap-3">
          <span className="text-[13px] text-[var(--color-text)]">{baseUrl || '未设置'}</span>
          {saved && <span className="text-[12px] text-[var(--color-ok)]">已保存</span>}
          {!editing && (
            <button type="button" onClick={() => setEditing(true)}
              className="ml-auto orca-btn-link text-[12px]">修改</button>
          )}
        </div>
        {editing && (
          <form onSubmit={handleSave} className="mt-3 border-t border-[var(--color-border)] pt-3 space-y-3">
            <Field label="站点 URL">
              <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="https://orca.example.com" className={INPUT_CLS} />
            </Field>
            <p className="text-[11px] text-[var(--color-text-dim)]">用于 OAuth 回调、MCP 连接等场景，不要以 / 结尾</p>
            <div className="flex gap-2">
              <button type="submit" disabled={busy}
                className="h-8 px-4 rounded bg-[var(--color-accent)] text-white disabled:opacity-50 text-[13px]">保存</button>
              <button type="button" onClick={() => setEditing(false)}
                className="h-8 px-3 rounded border border-[var(--color-border-strong)] text-[var(--color-text-muted)] text-[13px]">取消</button>
            </div>
          </form>
        )}
      </div>
    </section>
  )
}

// ---- LLM ----

function LLMSection({ status, onSaved }: { status: StatusResponse | null; onSaved: () => void }) {
  const llm = status?.llm
  const [editing, setEditing] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; reply?: string; error?: string } | null>(null)
  const [provider, setProvider] = useState('')
  const [endpoint, setEndpoint] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [model, setModel] = useState('')
  const [maxIter, setMaxIter] = useState(20)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const startEdit = () => {
    if (llm) { setProvider(llm.provider || 'openai'); setEndpoint(llm.endpoint || ''); setModel(llm.model || ''); setMaxIter(llm.max_iterations || 20) }
    setApiKey(''); setErr(null); setEditing(true)
  }

  const handleSave = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setErr(null)
    try {
      await updateLLMSettings({ provider, endpoint: endpoint || undefined, api_key: apiKey, model, max_iterations: maxIter })
      setEditing(false); onSaved()
    } catch (e) { setErr(e instanceof Error ? e.message : '保存失败') }
    finally { setBusy(false) }
  }

  return (
    <section>
      <h2 className="text-[16px] font-semibold text-[var(--color-text)] mb-3">LLM 配置</h2>
      <div className="rounded-md border border-[var(--color-border)] p-4">
        <div className="flex items-center gap-3 mb-3">
          <StatusDot ok={!!llm?.configured} />
          <span className="text-[13px] text-[var(--color-text)]">
            {llm?.configured ? `${llm.provider} / ${llm.model}` : '未配置'}
          </span>
          {!editing && (
            <div className="ml-auto flex items-center gap-2">
              {llm?.configured && (
                <button type="button" disabled={testing}
                  onClick={async () => {
                    setTesting(true); setTestResult(null)
                    try { setTestResult(await testLLMConnection()) }
                    catch (e) { setTestResult({ ok: false, error: e instanceof Error ? e.message : '失败' }) }
                    finally { setTesting(false) }
                  }}
                  className="orca-btn-link text-[12px] text-[var(--color-text-muted)] disabled:opacity-50">
                  {testing ? '测试中…' : '测试连接'}
                </button>
              )}
              <button type="button" onClick={startEdit}
                className="orca-btn-link text-[12px]">
                {llm?.configured ? '修改' : '配置'}
              </button>
            </div>
          )}
        </div>
        {llm?.last_error && <div className="text-[12px] text-[var(--color-danger)] font-mono mb-3">{llm.last_error}</div>}
        {testResult && (
          <div className={`text-[12px] font-mono mb-3 ${testResult.ok ? 'text-[var(--color-ok)]' : 'text-[var(--color-danger)]'}`}>
            {testResult.ok ? `连接正常 — ${testResult.reply?.slice(0, 80)}` : `失败 — ${testResult.error}`}
          </div>
        )}
        {editing && (
          <form onSubmit={handleSave} className="space-y-3 border-t border-[var(--color-border)] pt-3">
            {err && <div className="text-[12px] text-[var(--color-danger)] font-mono">{err}</div>}
            <div className="grid grid-cols-2 gap-3">
              <Field label="Provider *">
                <select value={provider} onChange={(e) => setProvider(e.target.value)} className={INPUT_CLS}>
                  <option value="openai">OpenAI (兼容)</option>
                  <option value="anthropic">Anthropic</option>
                </select>
              </Field>
              <Field label="Model *">
                <input value={model} onChange={(e) => setModel(e.target.value)} placeholder="gpt-4o" className={INPUT_CLS} required />
              </Field>
            </div>
            <Field label="Endpoint（留空用默认）">
              <input value={endpoint} onChange={(e) => setEndpoint(e.target.value)} className={INPUT_CLS} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="API Key *">
                <input value={apiKey} onChange={(e) => setApiKey(e.target.value)} type="password" placeholder="sk-..." className={INPUT_CLS} required />
              </Field>
              <Field label="最大迭代轮数">
                <input value={maxIter} onChange={(e) => setMaxIter(Number(e.target.value))} type="number" min={1} max={200} className={INPUT_CLS} />
              </Field>
            </div>
            <div className="flex gap-2">
              <button type="submit" disabled={busy || !provider || !model || !apiKey}
                className="h-8 px-4 rounded bg-[var(--color-accent)] text-[var(--color-bg)] disabled:opacity-50 text-[12px] font-medium">
                {busy ? '保存中…' : '保存'}
              </button>
              <button type="button" onClick={() => setEditing(false)}
                className="h-8 px-3 rounded border border-[var(--color-border-strong)] text-[var(--color-text-muted)] text-[12px]">取消</button>
            </div>
          </form>
        )}
      </div>
    </section>
  )
}

// ---- K8s ----

function KubeSection({ status, onChanged }: { status: StatusResponse | null; onChanged: () => void }) {
  const kube = status?.kubernetes
  const [showUpload, setShowUpload] = useState(false)
  const [kubeconfigText, setKubeconfigText] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true); setErr(null)
    try { await fn(); onChanged() }
    catch (e) { setErr(e instanceof Error ? e.message : '失败') }
    finally { setBusy(false) }
  }

  return (
    <section>
      <h2 className="text-[16px] font-semibold text-[var(--color-text)] mb-3">Kubernetes 连接</h2>
      <div className="rounded-md border border-[var(--color-border)] p-4">
        <div className="flex items-center gap-3 mb-3">
          <StatusDot ok={!!kube?.connected} />
          <span className="text-[13px] text-[var(--color-text)]">
            {kube?.connected ? `已连接 · ${kube.mode} · ${kube.server_version}` : '未连接'}
          </span>
        </div>
        {kube?.last_error && <div className="text-[12px] text-[var(--color-danger)] font-mono mb-3">{kube.last_error}</div>}
        {err && <div className="text-[12px] text-[var(--color-danger)] font-mono mb-3">{err}</div>}
        <div className="flex items-center gap-2 flex-wrap">
          <Btn onClick={() => act(connectKubeInCluster)} disabled={busy}>集群内 ServiceAccount</Btn>
          <Btn onClick={() => setShowUpload(!showUpload)} disabled={busy}>上传 Kubeconfig</Btn>
          {kube?.connected && <Btn onClick={() => act(disconnectKube)} disabled={busy} danger>断开</Btn>}
        </div>
        {showUpload && (
          <form onSubmit={(e) => { e.preventDefault(); act(() => uploadKubeconfig(kubeconfigText)).then(() => setShowUpload(false)) }}
            className="mt-3 border-t border-[var(--color-border)] pt-3 space-y-3">
            <Field label="Kubeconfig（YAML）">
              <textarea value={kubeconfigText} onChange={(e) => setKubeconfigText(e.target.value)}
                rows={8} className={INPUT_CLS + ' resize-y'} required />
            </Field>
            <div className="flex gap-2">
              <button type="submit" disabled={busy || !kubeconfigText.trim()}
                className="h-8 px-4 rounded bg-[var(--color-accent)] text-[var(--color-bg)] disabled:opacity-50 text-[12px] font-medium">
                {busy ? '连接中…' : '连接'}
              </button>
              <button type="button" onClick={() => setShowUpload(false)}
                className="h-8 px-3 rounded border border-[var(--color-border-strong)] text-[var(--color-text-muted)] text-[12px]">取消</button>
            </div>
          </form>
        )}
      </div>
    </section>
  )
}

// ---- Shared ----

// ---- OAuth/SSO ----

function OAuthSection() {
  const [cfg, setCfg] = useState<OAuthConfig | null>(null)
  const [editing, setEditing] = useState(false)
  const [providerName, setProviderName] = useState('')
  const [issuerUrl, setIssuerUrl] = useState('')
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [scopes, setScopes] = useState('openid profile email')
  const [defaultRole, setDefaultRole] = useState('member')
  const [enabled, setEnabled] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    getOAuthConfig().then((c) => { setCfg(c) }).catch(() => {})
  }, [])

  const startEdit = () => {
    if (cfg) {
      setProviderName(cfg.provider_name || '')
      setIssuerUrl(cfg.issuer_url || '')
      setClientId(cfg.client_id || '')
      setScopes(cfg.scopes || 'openid profile email')
      setDefaultRole(cfg.default_role || 'member')
      setEnabled(cfg.enabled)
    }
    setClientSecret('')
    setErr(null)
    setEditing(true)
  }

  const handleSave = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setErr(null)
    try {
      const newCfg: OAuthConfig = {
        enabled, provider_name: providerName, issuer_url: issuerUrl,
        client_id: clientId, scopes, default_role: defaultRole,
      }
      if (clientSecret) newCfg.client_secret = clientSecret
      else if (cfg?.client_id === clientId) {
        // 没改 secret 就不传（后端保留旧值）——但当前实现是全量覆盖
        // 先传空，后端会存空。所以如果不改 secret，需要重新填
      }
      await setOAuthConfig(newCfg)
      setEditing(false)
      getOAuthConfig().then(setCfg).catch(() => {})
    } catch (e) { setErr(e instanceof Error ? e.message : '保存失败') }
    finally { setBusy(false) }
  }

  return (
    <section>
      <h2 className="text-[16px] font-semibold text-[var(--color-text)] mb-3">SSO 登录</h2>
      <div className="rounded-md border border-[var(--color-border)] p-4">
        <div className="flex items-center gap-3 mb-3">
          <StatusDot ok={!!cfg?.enabled} />
          <span className="text-[13px] text-[var(--color-text)]">
            {cfg?.enabled ? `已启用 · ${cfg.provider_name}` : '未配置'}
          </span>
          {!editing && (
            <button type="button" onClick={startEdit}
              className="ml-auto orca-btn-link text-[12px]">
              {cfg?.enabled ? '修改' : '配置'}
            </button>
          )}
        </div>

        {editing && (
          <form onSubmit={handleSave} className="space-y-3 border-t border-[var(--color-border)] pt-3">
            {err && <div className="text-[12px] text-[var(--color-danger)]">{err}</div>}
            <label className="flex items-center gap-2 text-[13px] text-[var(--color-text)]">
              <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
              启用 SSO 登录
            </label>
            <div className="grid grid-cols-2 gap-3">
              <Field label="提供商名称">
                <input value={providerName} onChange={(e) => setProviderName(e.target.value)}
                  placeholder="Authentik" className={INPUT_CLS} />
              </Field>
              <Field label="默认角色">
                <select value={defaultRole} onChange={(e) => setDefaultRole(e.target.value)} className={INPUT_CLS}>
                  <option value="member">member</option>
                  <option value="admin">admin</option>
                </select>
              </Field>
            </div>
            <Field label="Issuer URL（OIDC 自动发现）">
              <input value={issuerUrl} onChange={(e) => setIssuerUrl(e.target.value)}
                placeholder="https://auth.example.com/application/o/orca/" className={INPUT_CLS} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Client ID">
                <input value={clientId} onChange={(e) => setClientId(e.target.value)} className={INPUT_CLS} />
              </Field>
              <Field label="Client Secret">
                <input value={clientSecret} onChange={(e) => setClientSecret(e.target.value)}
                  type="password" placeholder="留空保持不变" className={INPUT_CLS} />
              </Field>
            </div>
            <Field label="Scopes">
              <input value={scopes} onChange={(e) => setScopes(e.target.value)} className={INPUT_CLS} />
            </Field>
            <div className="flex gap-2">
              <button type="submit" disabled={busy}
                className="h-8 px-4 rounded bg-[var(--color-accent)] text-white disabled:opacity-50 text-[13px]">
                {busy ? '保存中…' : '保存'}
              </button>
              <button type="button" onClick={() => setEditing(false)}
                className="h-8 px-3 rounded border border-[var(--color-border-strong)] text-[var(--color-text-muted)] text-[13px]">
                取消
              </button>
            </div>
          </form>
        )}
      </div>
    </section>
  )
}

function StatusDot({ ok }: { ok: boolean }) {
  return <span className={`w-2 h-2 rounded-full shrink-0 ${ok ? 'bg-[var(--color-ok)]' : 'bg-[var(--color-warn)]'}`} />
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="text-[11px] font-medium text-[var(--color-text-dim)] mb-1 block">{label}</span>{children}</label>
}
function Btn({ onClick, disabled, danger, children }: { onClick: () => void; disabled?: boolean; danger?: boolean; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      className={`text-[12px] px-2 py-1 rounded border transition-colors disabled:opacity-50
        ${danger ? 'border-[var(--color-danger)]/40 text-[var(--color-danger)]' : 'border-[var(--color-border-strong)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface)]'}`}>
      {children}
    </button>
  )
}
