import { useEffect, useState, type FormEvent } from 'react'
import {
  getStatus,
  updateLLMSettings,
  testLLMConnection,
  connectKubeInCluster,
  uploadKubeconfig,
  disconnectKube,
  type StatusResponse,
} from '../api'

interface Props {
  refreshToken: number
}

export function SettingsPanel({ refreshToken }: Props) {
  const [status, setStatus] = useState<StatusResponse | null>(null)
  const reloadStatus = () => { getStatus().then(setStatus).catch(() => {}) }
  useEffect(() => { reloadStatus() }, [refreshToken])

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-3xl mx-auto px-8 py-8 space-y-10">
        <h1 className="text-[22px] font-semibold text-[var(--color-text)]">设置</h1>
        <LLMSection status={status} onSaved={reloadStatus} />
        <KubeSection status={status} onChanged={reloadStatus} />
      </div>
    </div>
  )
}

const INPUT_CLS = `w-full px-2.5 py-1.5 rounded border border-[var(--color-border-strong)]
  bg-[var(--color-bg)] text-[13px] text-[var(--color-text)]
  focus:outline-none focus:border-[var(--color-text)]
  placeholder-[var(--color-text-dim)] font-mono transition-colors`

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
                  className="text-[11px] font-mono text-[var(--color-text-muted)] hover:text-[var(--color-text)] disabled:opacity-50">
                  {testing ? '测试中…' : '测试连接'}
                </button>
              )}
              <button type="button" onClick={startEdit}
                className="text-[11px] font-mono text-[var(--color-accent)] hover:underline">
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
            <Field label="API Key *">
              <input value={apiKey} onChange={(e) => setApiKey(e.target.value)} type="password" placeholder="sk-..." className={INPUT_CLS} required />
            </Field>
            <div className="flex gap-2">
              <button type="submit" disabled={busy || !provider || !model || !apiKey}
                className="h-8 px-4 rounded bg-[var(--color-accent)] text-[var(--color-bg)] disabled:opacity-50 font-mono text-[11px] uppercase tracking-[0.15em]">
                {busy ? '保存中…' : '保存'}
              </button>
              <button type="button" onClick={() => setEditing(false)}
                className="h-8 px-3 rounded border border-[var(--color-border-strong)] text-[var(--color-text-muted)] font-mono text-[11px]">取消</button>
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
                className="h-8 px-4 rounded bg-[var(--color-accent)] text-[var(--color-bg)] disabled:opacity-50 font-mono text-[11px] uppercase">
                {busy ? '连接中…' : '连接'}
              </button>
              <button type="button" onClick={() => setShowUpload(false)}
                className="h-8 px-3 rounded border border-[var(--color-border-strong)] text-[var(--color-text-muted)] font-mono text-[11px]">取消</button>
            </div>
          </form>
        )}
      </div>
    </section>
  )
}

// ---- Shared ----

function StatusDot({ ok }: { ok: boolean }) {
  return <span className={`w-2 h-2 rounded-full shrink-0 ${ok ? 'bg-[var(--color-ok)]' : 'bg-[var(--color-warn)]'}`} />
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="text-[11px] font-mono text-[var(--color-text-dim)] mb-1 block">{label}</span>{children}</label>
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
