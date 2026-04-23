import { useEffect, useState, type FormEvent } from 'react'
import { getAuthStatus, setupAdmin, login, setToken, clearToken, type AuthStatus } from '../api'

interface Props {
  children: React.ReactNode
  onUser: (user: AuthStatus['user']) => void
}

export function AuthGuard({ children, onUser }: Props) {
  const [status, setStatus] = useState<AuthStatus | null>(null)
  const [loading, setLoading] = useState(true)

  const check = () => {
    setLoading(true)
    getAuthStatus()
      .then((s) => {
        setStatus(s)
        if (s.user) onUser(s.user)
      })
      .catch(() => setStatus({ initialized: false }))
      .finally(() => setLoading(false))
  }

  useEffect(() => { check() }, [])

  if (loading) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-[var(--color-bg)]">
        <div className="text-[14px] text-[var(--color-text-dim)]">加载中…</div>
      </div>
    )
  }

  // 未初始化 → 设置管理员
  if (status && !status.initialized) {
    return <SetupPage onDone={check} />
  }

  // 已初始化但未登录
  if (status && status.initialized && !status.user) {
    return <LoginPage onDone={check}
      oauthEnabled={!!status.oauth_enabled}
      oauthProviderName={status.oauth_provider_name || 'SSO'} />
  }

  // 已登录
  return <>{children}</>
}

function SetupPage({ onDone }: { onDone: () => void }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [baseUrl, setBaseUrl] = useState(() => window.location.origin)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (password !== confirm) { setErr('两次密码不一致'); return }
    if (password.length < 6) { setErr('密码至少 6 位'); return }
    setBusy(true); setErr(null)
    try {
      const res = await setupAdmin(username, password, baseUrl)
      setToken(res.token)
      onDone()
    } catch (e) {
      setErr(e instanceof Error ? e.message : '设置失败')
    } finally { setBusy(false) }
  }

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-[var(--color-bg)]">
      <div className="w-full max-w-sm px-6">
        <div className="mb-8 text-center">
          <h1 className="text-[28px] font-semibold text-[var(--color-text)] mb-2">欢迎使用 Orca</h1>
          <p className="text-[14px] text-[var(--color-text-muted)]">初始化配置</p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          {err && <div className="text-[13px] text-[var(--color-danger)]">{err}</div>}
          <div>
            <label className="block text-[13px] text-[var(--color-text-muted)] mb-1">站点 URL</label>
            <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)}
              className={INPUT_CLS} placeholder="https://orca.example.com" required />
            <p className="text-[11px] text-[var(--color-text-dim)] mt-1">用于 OAuth 回调等场景，不要以 / 结尾</p>
          </div>
          <div>
            <label className="block text-[13px] text-[var(--color-text-muted)] mb-1">管理员用户名</label>
            <input value={username} onChange={(e) => setUsername(e.target.value)}
              className={INPUT_CLS} placeholder="admin" required />
          </div>
          <div>
            <label className="block text-[13px] text-[var(--color-text-muted)] mb-1">密码</label>
            <input value={password} onChange={(e) => setPassword(e.target.value)}
              type="password" className={INPUT_CLS} placeholder="至少 6 位" required />
          </div>
          <div>
            <label className="block text-[13px] text-[var(--color-text-muted)] mb-1">确认密码</label>
            <input value={confirm} onChange={(e) => setConfirm(e.target.value)}
              type="password" className={INPUT_CLS} required />
          </div>
          <button type="submit" disabled={busy || !username || !password}
            className="w-full h-10 rounded-md bg-[var(--color-accent)] text-white
              hover:bg-[var(--color-accent-hover)] disabled:opacity-50
              text-[14px] font-medium transition-colors">
            {busy ? '创建中…' : '创建管理员'}
          </button>
        </form>
      </div>
    </div>
  )
}

function LoginPage({ onDone, oauthEnabled, oauthProviderName }: {
  onDone: () => void; oauthEnabled: boolean; oauthProviderName: string
}) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // SSO postMessage 监听
  useEffect(() => {
    if (!oauthEnabled) return
    const handler = (e: MessageEvent) => {
      if (e.data?.type === 'orca-sso-done' && e.data.token) {
        setToken(e.data.token)
        onDone()
      }
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [oauthEnabled, onDone])

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true); setErr(null)
    try {
      const res = await login(username, password)
      setToken(res.token)
      onDone()
    } catch (e) {
      setErr(e instanceof Error ? e.message : '登录失败')
    } finally { setBusy(false) }
  }

  const handleSSO = () => {
    window.open('/api/auth/oauth/authorize', 'orca-sso', 'width=600,height=700')
  }

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-[var(--color-bg)]">
      <div className="w-full max-w-sm px-6">
        <div className="mb-8 text-center">
          <h1 className="text-[28px] font-semibold text-[var(--color-text)] mb-2">Orca</h1>
          <p className="text-[14px] text-[var(--color-text-muted)]">登录以继续</p>
        </div>

        {oauthEnabled && (
          <div className="mb-6">
            <button type="button" onClick={handleSSO}
              className="w-full h-10 rounded-md border border-[var(--color-border-strong)]
                bg-[var(--color-bg)] text-[14px] text-[var(--color-text)]
                hover:bg-[var(--color-surface-2)] transition-colors font-medium">
              通过 {oauthProviderName} 登录
            </button>
            <div className="flex items-center gap-3 my-5">
              <div className="flex-1 border-t border-[var(--color-border)]" />
              <span className="text-[12px] text-[var(--color-text-dim)]">或用密码登录</span>
              <div className="flex-1 border-t border-[var(--color-border)]" />
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {err && <div className="text-[13px] text-[var(--color-danger)]">{err}</div>}
          <div>
            <label className="block text-[13px] text-[var(--color-text-muted)] mb-1">用户名</label>
            <input value={username} onChange={(e) => setUsername(e.target.value)}
              className={INPUT_CLS} required autoFocus={!oauthEnabled} />
          </div>
          <div>
            <label className="block text-[13px] text-[var(--color-text-muted)] mb-1">密码</label>
            <input value={password} onChange={(e) => setPassword(e.target.value)}
              type="password" className={INPUT_CLS} required />
          </div>
          <button type="submit" disabled={busy || !username || !password}
            className="w-full h-10 rounded-md bg-[var(--color-accent)] text-white
              hover:bg-[var(--color-accent-hover)] disabled:opacity-50
              text-[14px] font-medium transition-colors">
            {busy ? '登录中…' : '登录'}
          </button>
        </form>
      </div>
    </div>
  )
}

const INPUT_CLS = `w-full h-10 px-3 rounded-md border border-[var(--color-border-strong)]
  bg-[var(--color-bg)] text-[14px] text-[var(--color-text)]
  focus:outline-none focus:border-[var(--color-accent)] focus:ring-1 focus:ring-[var(--color-accent)]
  placeholder-[var(--color-text-dim)] transition-colors`

// 导出登出函数供 IconRail 用
export function logout() {
  clearToken()
  window.location.reload()
}
