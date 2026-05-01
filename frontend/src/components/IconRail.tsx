import { getStatus, type StatusResponse } from '../api'
import { useEffect, useState } from 'react'
import { applyTheme, type Theme } from '../theme'
import { logout } from './AuthGuard'

export type Module = 'home' | 'chat' | 'events' | 'investigations' | 'knowledge' | 'patrol' | 'triggers' | 'mcp' | 'notifications' | 'settings'

interface Props {
  active: Module
  onSelect: (m: Module) => void
  username?: string
}

const currentTheme = (): Theme =>
  (document.documentElement.getAttribute('data-theme') as Theme) || 'light'

export function IconRail({ active, onSelect, username }: Props) {
  const [status, setStatus] = useState<StatusResponse | null>(null)
  const [theme, setTheme] = useState<Theme>(currentTheme())

  useEffect(() => {
    const load = () => getStatus().then(setStatus).catch(() => {})
    load()
    const t = setInterval(load, 30_000)
    return () => clearInterval(t)
  }, [])

  const toggleTheme = () => {
    const next: Theme = theme === 'light' ? 'dark' : 'light'
    applyTheme(next)
    setTheme(next)
  }

  const llmOk = !!status?.llm.configured
  const kubeOk = !!status?.kubernetes.connected

  return (
    <aside className="w-[180px] shrink-0 flex flex-col h-full
      bg-[var(--color-sidebar-bg)] border-r border-[var(--color-sidebar-border)]">
      {/* Logo */}
      <div className="px-4 pt-5 pb-4">
        <button
          type="button"
          onClick={() => onSelect('home')}
          className="flex items-baseline gap-1.5"
        >
          <span className="font-serif-display text-[22px] text-[var(--color-text)]">orca</span>
          <WaveMark className="w-4 h-1.5 text-[var(--color-accent)]" />
        </button>
      </div>

      {/* Main nav */}
      <nav className="flex-1 px-2 space-y-0.5 overflow-y-auto">
        <NavItem icon={<HomeIcon />} label="主页" module="home" active={active} onSelect={onSelect} />
        <NavItem icon={<ChatIcon />} label="对话" module="chat" active={active} onSelect={onSelect} />
        <NavItem icon={<EventIcon />} label="事件" module="events" active={active} onSelect={onSelect} />
        <NavItem icon={<InvestigationIcon />} label="调查" module="investigations" active={active} onSelect={onSelect} />
        <NavItem icon={<KnowledgeIcon />} label="知识库" module="knowledge" active={active} onSelect={onSelect} />
        <NavItem icon={<PatrolIcon />} label="巡检" module="patrol" active={active} onSelect={onSelect} />

        <div className="my-2 mx-2 border-t border-[var(--color-border)]" />

        <NavItem icon={<TriggerIcon />} label="触发器" module="triggers" active={active} onSelect={onSelect} />
        <NavItem icon={<ToolIcon />} label="工具" module="mcp" active={active} onSelect={onSelect} />
        <NavItem icon={<BellIcon />} label="通知" module="notifications" active={active} onSelect={onSelect} />
      </nav>

      {/* Bottom: status + settings + theme */}
      <div className="border-t border-[var(--color-border)] px-2 py-2 space-y-0.5">
        <NavItem icon={<SettingsIcon />} label="设置" module="settings" active={active} onSelect={onSelect} />

        {username && (
          <div className="flex items-center gap-2 px-2.5 py-1.5 mt-1">
            <span className="w-6 h-6 rounded-full bg-[var(--color-accent)] text-white
              text-[11px] font-medium grid place-items-center shrink-0">
              {username[0].toUpperCase()}
            </span>
            <span className="text-[12px] text-[var(--color-text)] truncate flex-1">{username}</span>
          </div>
        )}

        <div className="flex items-center justify-between px-2.5 py-1.5">
          <div className="flex items-center gap-2 text-[12px] text-[var(--color-text-dim)]">
            <span className={`w-1.5 h-1.5 rounded-full ${llmOk ? 'bg-[var(--color-ok)]' : 'bg-[var(--color-warn)]'}`} />
            <span>LLM</span>
            <span className={`w-1.5 h-1.5 rounded-full ml-1 ${kubeOk ? 'bg-[var(--color-ok)]' : 'bg-[var(--color-warn)]'}`} />
            <span>K8s</span>
          </div>
          <button
            type="button"
            onClick={toggleTheme}
            className="w-7 h-7 grid place-items-center rounded
              text-[var(--color-text-dim)] hover:text-[var(--color-text)]
              hover:bg-[var(--color-surface-2)] transition-colors"
            title={theme === 'light' ? '暗色模式' : '亮色模式'}
          >
            {theme === 'light' ? <MoonIcon /> : <SunIcon />}
          </button>
          <button
            type="button"
            onClick={logout}
            className="w-7 h-7 grid place-items-center rounded
              text-[var(--color-text-dim)] hover:text-[var(--color-danger)]
              hover:bg-[var(--color-surface-2)] transition-colors"
            title="登出"
          >
            <LogoutIcon />
          </button>
        </div>
      </div>
    </aside>
  )
}

function NavItem({ icon, label, module, active, onSelect }: {
  icon: React.ReactNode
  label: string
  module: Module
  active: Module
  onSelect: (m: Module) => void
}) {
  const isActive = active === module
  return (
    <button
      type="button"
      onClick={() => onSelect(module)}
      className={`w-full flex items-center gap-2.5 px-2.5 py-[7px] rounded-lg
        text-[14px] transition-colors relative
        ${isActive
          ? 'bg-[var(--color-surface-2)] text-[var(--color-text)] font-semibold'
          : 'text-[var(--color-text-dim)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-2)]'}`}
    >
      {isActive && (
        <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 bg-[var(--color-accent)] rounded-r" />
      )}
      <span className="w-[18px] h-[18px] shrink-0">{icon}</span>
      <span>{label}</span>
    </button>
  )
}

// ---- SVG Icons ----

function WaveMark({ className }: { className?: string }) {
  return <svg viewBox="0 0 40 8" className={className} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M1 4 Q 6 1, 11 4 T 21 4 T 31 4 T 39 4" /></svg>
}
function HomeIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12l9-8 9 8" /><path d="M5 10v10a1 1 0 001 1h3v-6h6v6h3a1 1 0 001-1V10" /></svg>
}
function ChatIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" /></svg>
}
function EventIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" /></svg>
}
function InvestigationIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" /></svg>
}
function KnowledgeIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2z" /><path d="M22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z" /></svg>
}
function PatrolIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
}
function TriggerIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M18 20V10" /><path d="M12 20V4" /><path d="M6 20v-6" /></svg>
}
function ToolIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z" /></svg>
}
function SettingsIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" /></svg>
}
function BellIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 01-3.46 0" /></svg>
}
function LogoutIcon() {
  return <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></svg>
}
function MoonIcon() {
  return <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" /></svg>
}
function SunIcon() {
  return <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" /></svg>
}
