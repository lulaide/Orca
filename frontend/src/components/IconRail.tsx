import { getStatus, type StatusResponse } from '../api'
import { useEffect, useState } from 'react'
import { applyTheme, type Theme } from '../theme'

export type Module = 'home' | 'chat' | 'events' | 'investigations' | 'knowledge' | 'triggers' | 'mcp' | 'settings'

interface Props {
  active: Module
  onSelect: (m: Module) => void
}

const currentTheme = (): Theme =>
  (document.documentElement.getAttribute('data-theme') as Theme) || 'light'

export function IconRail({ active, onSelect }: Props) {
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

  return (
    <aside className="w-14 shrink-0 flex flex-col items-center h-full
      bg-[var(--color-surface)] border-r border-[var(--color-border)]
      py-3 gap-1">
      {/* Logo */}
      <button
        type="button"
        onClick={() => onSelect('home')}
        className="w-10 h-10 grid place-items-center mb-2"
        title="Orca"
      >
        <span className="font-serif-display text-[18px] text-[var(--color-text)]">o</span>
      </button>

      {/* Navigation */}
      <NavItem icon={<HomeIcon />} label="主页" module="home" active={active} onSelect={onSelect} />
      <NavItem icon={<ChatIcon />} label="对话" module="chat" active={active} onSelect={onSelect} />
      <NavItem icon={<EventIcon />} label="事件" module="events" active={active} onSelect={onSelect} />
      <NavItem icon={<InvestigationIcon />} label="调查" module="investigations" active={active} onSelect={onSelect} />
      <NavItem icon={<KnowledgeIcon />} label="知识" module="knowledge" active={active} onSelect={onSelect} />

      <div className="w-6 border-t border-[var(--color-border)] my-1" />

      <NavItem icon={<TriggerIcon />} label="触发" module="triggers" active={active} onSelect={onSelect} />
      <NavItem icon={<MCPIcon />} label="MCP" module="mcp" active={active} onSelect={onSelect} />

      {/* Spacer */}
      <div className="flex-1" />

      {/* Settings */}
      <NavItem icon={<SettingsIcon />} label="设置" module="settings" active={active} onSelect={onSelect} />

      {/* Status indicators */}
      <div className="flex items-center gap-1.5 mt-1 mb-1" title={
        `LLM: ${status?.llm.configured ? 'OK' : '未配置'}\nK8s: ${status?.kubernetes.connected ? 'OK' : '未连接'}`
      }>
        <span className={`w-1.5 h-1.5 rounded-full ${
          status?.llm.configured ? 'bg-[var(--color-ok)]' : 'bg-[var(--color-warn)]'
        }`} />
        <span className={`w-1.5 h-1.5 rounded-full ${
          status?.kubernetes.connected ? 'bg-[var(--color-ok)]' : 'bg-[var(--color-warn)]'
        }`} />
      </div>

      {/* Theme toggle */}
      <button
        type="button"
        onClick={toggleTheme}
        className="w-8 h-8 grid place-items-center rounded
          text-[var(--color-text-dim)] hover:text-[var(--color-text)]
          hover:bg-[var(--color-surface-2)] transition-colors"
        title={theme === 'light' ? '暗色模式' : '亮色模式'}
      >
        {theme === 'light' ? <MoonIcon /> : <SunIcon />}
      </button>
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
      className={`w-10 h-10 flex flex-col items-center justify-center gap-0.5 rounded-lg
        transition-colors relative
        ${isActive
          ? 'bg-[var(--color-bg)] text-[var(--color-text)]'
          : 'text-[var(--color-text-dim)] hover:text-[var(--color-text)] hover:bg-[var(--color-bg)]'}`}
      title={label}
    >
      {isActive && (
        <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[2px] h-5 bg-[var(--color-accent)] rounded-r" />
      )}
      <span className="w-[18px] h-[18px]">{icon}</span>
      <span className="text-[8px] leading-none font-mono">{label}</span>
    </button>
  )
}

// ---- SVG Icons (18x18 outline style) ----

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
function TriggerIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M18 20V10" /><path d="M12 20V4" /><path d="M6 20v-6" /></svg>
}
function MCPIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="2" width="20" height="8" rx="2" /><rect x="2" y="14" width="20" height="8" rx="2" /><circle cx="6" cy="6" r="1" fill="currentColor" /><circle cx="6" cy="18" r="1" fill="currentColor" /></svg>
}
function SettingsIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" /></svg>
}
function MoonIcon() {
  return <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" /></svg>
}
function SunIcon() {
  return <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" /></svg>
}
