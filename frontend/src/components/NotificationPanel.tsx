import { useEffect, useState, type FormEvent } from 'react'
import { authFetch } from '../api'

const INPUT_CLS = `w-full px-2.5 py-1.5 rounded border border-[var(--color-border-strong)]
  bg-[var(--color-bg)] text-[13px] text-[var(--color-text)]
  focus:outline-none focus:border-[var(--color-accent)]
  placeholder-[var(--color-text-dim)] font-mono transition-colors`

export function NotificationPanel() {
  const [cfg, setCfg] = useState<{ enabled: boolean; app_id: string; chat_id: string } | null>(null)
  const [editing, setEditing] = useState(false)
  const [enabled, setEnabled] = useState(false)
  const [appId, setAppId] = useState('')
  const [appSecret, setAppSecret] = useState('')
  const [chatId, setChatId] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<string | null>(null)

  const reload = () => {
    authFetch('/api/settings/notification').then(r => r.json()).then(setCfg).catch(() => {})
  }

  useEffect(() => { reload() }, [])

  const startEdit = () => {
    if (cfg) { setEnabled(cfg.enabled); setAppId(cfg.app_id || ''); setChatId(cfg.chat_id || '') }
    setAppSecret(''); setErr(null); setEditing(true)
  }

  const handleSave = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setErr(null)
    try {
      await authFetch('/api/settings/notification', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled, app_id: appId, app_secret: appSecret || undefined, chat_id: chatId }),
      })
      setEditing(false); reload()
    } catch (e) { setErr(e instanceof Error ? e.message : '保存失败') }
    finally { setBusy(false) }
  }

  const handleTest = async () => {
    setBusy(true); setTestResult(null)
    try {
      const res = await authFetch('/api/settings/notification/test', { method: 'POST' })
      if (res.ok) setTestResult('已发送')
      else { const d = await res.json(); setTestResult((d as {error?: string}).error || '发送失败') }
    } catch { setTestResult('发送失败') }
    finally { setBusy(false) }
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-3xl mx-auto px-8 py-8">
        <h1 className="text-[22px] font-semibold text-[var(--color-text)] mb-6">通知</h1>

        {/* 飞书 */}
        <section>
          <h2 className="text-[16px] font-semibold text-[var(--color-text)] mb-3">飞书应用机器人</h2>
          <p className="text-[13px] text-[var(--color-text-muted)] mb-4">
            事件创建、调查创建、调查解决时自动推送卡片消息到飞书群。
          </p>
          <div className="rounded-md border border-[var(--color-border)] p-4">
            <div className="flex items-center gap-3 mb-3">
              <span className={`w-2 h-2 rounded-full shrink-0 ${cfg?.enabled ? 'bg-[var(--color-ok)]' : 'bg-[var(--color-warn)]'}`} />
              <span className="text-[13px] text-[var(--color-text)]">
                {cfg?.enabled ? '已启用' : '未配置'}
              </span>
              {cfg?.enabled && cfg.app_id && (
                <span className="text-[12px] text-[var(--color-text-dim)]">App: {cfg.app_id}</span>
              )}
              {!editing && (
                <div className="ml-auto flex items-center gap-2">
                  {cfg?.enabled && (
                    <button type="button" onClick={handleTest} disabled={busy}
                      className="orca-btn-link text-[12px] text-[var(--color-text-muted)] disabled:opacity-50">
                      测试发送
                    </button>
                  )}
                  <button type="button" onClick={startEdit}
                    className="orca-btn-link text-[12px]">
                    {cfg?.enabled ? '修改' : '配置'}
                  </button>
                </div>
              )}
            </div>
            {testResult && <div className="text-[12px] text-[var(--color-ok)] mb-3">{testResult}</div>}

            {editing && (
              <form onSubmit={handleSave} className="space-y-3 border-t border-[var(--color-border)] pt-3">
                {err && <div className="text-[12px] text-[var(--color-danger)]">{err}</div>}
                <label className="flex items-center gap-2 text-[13px] text-[var(--color-text)]">
                  <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
                  启用飞书通知
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <label className="block">
                    <span className="text-[12px] text-[var(--color-text-dim)] mb-1 block">App ID</span>
                    <input value={appId} onChange={(e) => setAppId(e.target.value)} className={INPUT_CLS} />
                  </label>
                  <label className="block">
                    <span className="text-[12px] text-[var(--color-text-dim)] mb-1 block">App Secret</span>
                    <input value={appSecret} onChange={(e) => setAppSecret(e.target.value)} type="password" placeholder="留空保持不变" className={INPUT_CLS} />
                  </label>
                </div>
                <label className="block">
                  <span className="text-[12px] text-[var(--color-text-dim)] mb-1 block">群 Chat ID</span>
                  <input value={chatId} onChange={(e) => setChatId(e.target.value)} placeholder="oc_xxx" className={INPUT_CLS} />
                </label>
                <p className="text-[11px] text-[var(--color-text-dim)]">
                  在飞书开放平台创建应用，添加「机器人」能力，获取 App ID 和 Secret。
                  将机器人添加到目标群后，通过 API 获取群的 Chat ID。
                </p>
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
      </div>
    </div>
  )
}
