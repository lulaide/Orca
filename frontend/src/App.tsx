import { useEffect, useState } from 'react'
import { AuthGuard } from './components/AuthGuard'
import { IconRail, type Module } from './components/IconRail'
import { SecondaryPanel } from './components/SecondaryPanel'
import { ChatPanel } from './components/ChatPanel'
import { DashboardPanel } from './components/DashboardPanel'
// HomePanel 暂未使用（Dashboard 取代了首页）
// import { HomePanel } from './components/HomePanel'
import { InvestigationDetailPanel } from './components/InvestigationDetailPanel'
import { EventDetailPanel } from './components/EventDetailPanel'
import { TriggersPanel } from './components/TriggersPanel'
import { MCPPanel } from './components/MCPPanel'
import { KnowledgePanel } from './components/KnowledgePanel'
import { PatrolPanel } from './components/PatrolPanel'
import { NotificationPanel } from './components/NotificationPanel'
import { SettingsPanel } from './components/SettingsPanel'
import type { InvestigationView, ReferencedInvestigation, AuthStatus } from './api'

// ---- Route 定义 ----

type Route =
  | { module: 'home' }
  | { module: 'chat'; conversationId: string | null }
  | { module: 'events'; eventId: string | null }
  | { module: 'investigations'; id: string | null; view: InvestigationView }
  | { module: 'knowledge'; slug: string | null }
  | { module: 'patrol'; patrolId: string | null }
  | { module: 'triggers' }
  | { module: 'mcp' }
  | { module: 'notifications' }
  | { module: 'settings' }

function parseRoute(pathname: string, search: string): Route {
  // /settings
  if (pathname === '/notifications' || pathname === '/notifications/') return { module: 'notifications' }
  if (pathname === '/settings' || pathname === '/settings/') return { module: 'settings' }
  // /triggers
  if (pathname === '/triggers' || pathname === '/triggers/') return { module: 'triggers' }
  // /mcp
  if (pathname === '/mcp' || pathname === '/mcp/') return { module: 'mcp' }
  // /knowledge/{slug}
  if (pathname.startsWith('/knowledge/')) {
    return { module: 'knowledge', slug: pathname.slice('/knowledge/'.length) || null }
  }
  if (pathname === '/knowledge') return { module: 'knowledge', slug: null }
  if (pathname.startsWith('/patrol/')) {
    return { module: 'patrol', patrolId: pathname.slice('/patrol/'.length) || null }
  }
  if (pathname === '/patrol') return { module: 'patrol', patrolId: null }
  // /events/{id}
  const evDetail = pathname.match(/^\/events\/([A-Za-z0-9_-]{6,})$/)
  if (evDetail) return { module: 'events', eventId: evDetail[1] }
  if (pathname === '/events' || pathname === '/events/') return { module: 'events', eventId: null }
  // /i/{id}
  const invDetail = pathname.match(/^\/i\/([A-Za-z0-9_-]{6,})$/)
  if (invDetail) return { module: 'investigations', id: invDetail[1], view: 'active' }
  if (pathname === '/i' || pathname === '/i/') {
    const sp = new URLSearchParams(search)
    const v = sp.get('view') as InvestigationView | null
    const view: InvestigationView = v === 'active' || v === 'resolved' || v === 'archived' || v === 'all' ? v : 'active'
    return { module: 'investigations', id: null, view }
  }
  // /c/{id}
  const convMatch = pathname.match(/^\/c\/([A-Za-z0-9_-]{6,})$/)
  if (convMatch) return { module: 'chat', conversationId: convMatch[1] }
  if (pathname === '/c' || pathname === '/c/') return { module: 'chat', conversationId: null }
  // / → home
  return { module: 'home' }
}

function getModule(route: Route): Module {
  return route.module
}

const MODULES_WITH_PANEL: Module[] = ['chat', 'events', 'investigations', 'knowledge', 'patrol']

function App() {
  const [route, setRoute] = useState<Route>(() =>
    parseRoute(window.location.pathname, window.location.search),
  )
  const [refreshToken, setRefreshToken] = useState(0)
  const [currentUser, setCurrentUser] = useState<AuthStatus['user']>(undefined)
  const [pendingInitialMessage, setPendingInitialMessage] = useState<string | null>(null)
  const [pendingInitialRefs, setPendingInitialRefs] = useState<ReferencedInvestigation[]>([])

  const bumpRefresh = () => setRefreshToken((v) => v + 1)

  useEffect(() => {
    const onPop = () => setRoute(parseRoute(window.location.pathname, window.location.search))
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const nav = (path: string) => {
    if (window.location.pathname + window.location.search !== path) {
      window.history.pushState(null, '', path)
    }
    setRoute(parseRoute(path.split('?')[0], path.includes('?') ? path.split('?')[1] : ''))
  }

  const handleModuleSelect = (m: Module) => {
    const paths: Record<Module, string> = {
      home: '/',
      chat: '/c',
      events: '/events',
      investigations: '/i',
      knowledge: '/knowledge',
      patrol: '/patrol',
      triggers: '/triggers',
      mcp: '/mcp',
      notifications: '/notifications',
      settings: '/settings',
    }
    nav(paths[m])
  }

  const handleSelectConversation = (id: string | null) => {
    if (id === null) {
      nav('/c')
    } else {
      nav(`/c/${id}`)
    }
  }

  const handleConversationCreated = (id: string) => {
    setRoute({ module: 'chat', conversationId: id })
    window.history.replaceState(null, '', `/c/${id}`)
    bumpRefresh()
  }



  const handleSelectKnowledgeSlug = (slug: string) => {
    nav(`/knowledge/${slug}`)
  }

  const module = getModule(route)
  const hasSecondaryPanel = MODULES_WITH_PANEL.includes(module)

  const activeConversationId = route.module === 'chat' ? route.conversationId : null
  const activeEventId = route.module === 'events' ? route.eventId : null
  const activeInvestigationId = route.module === 'investigations' ? route.id : null
  const investigationView = route.module === 'investigations' ? route.view : 'active' as InvestigationView
  const activeKnowledgeSlug = route.module === 'knowledge' ? route.slug : null

  // 移动端：有详情内容时隐藏列表
  const hasDetail =
    (route.module === 'chat' && route.conversationId !== null) ||
    (route.module === 'events' && route.eventId !== null) ||
    (route.module === 'investigations' && route.id !== null) ||
    (route.module === 'knowledge' && route.slug !== null) ||
    (route.module === 'patrol' && route.patrolId !== null)

  return (
    <AuthGuard onUser={setCurrentUser}>
    <div className="flex w-full h-full bg-[var(--color-bg)] overflow-x-hidden">
      {/* 桌面侧栏 */}
      <div className="hidden md:flex">
        <IconRail active={module} onSelect={handleModuleSelect} username={currentUser?.username} />
      </div>

      {/* 二级面板：桌面常驻，移动端全屏（无详情时显示） */}
      {hasSecondaryPanel && (
        <div className={`${hasDetail ? 'hidden md:flex' : 'flex'} md:flex`}>
          <SecondaryPanel
            module={module}
            refreshToken={refreshToken}
            activeConversationId={activeConversationId}
            onSelectConversation={handleSelectConversation}
            activeEventId={activeEventId}
            activeInvestigationId={activeInvestigationId}
            investigationView={investigationView}
            activeKnowledgeSlug={activeKnowledgeSlug}
            onSelectKnowledgeSlug={handleSelectKnowledgeSlug}
          />
        </div>
      )}

      {/* 主内容：移动端全宽 */}
      <main className={`flex-1 flex flex-col min-w-0 h-full ${hasSecondaryPanel && !hasDetail ? 'hidden md:flex' : 'flex'}`}>
        {route.module === 'home' && (
          <DashboardPanel />
        )}
        {route.module === 'chat' && (
          <ChatPanel
            conversationId={route.conversationId}
            onConversationCreated={handleConversationCreated}
            onConversationUpdated={bumpRefresh}
            initialMessage={pendingInitialMessage}
            initialReferencedInvestigations={pendingInitialRefs}
            onInitialMessageConsumed={() => { setPendingInitialMessage(null); setPendingInitialRefs([]) }}
          />
        )}
        {route.module === 'events' && route.eventId && (
          <EventDetailPanel id={route.eventId} />
        )}
        {route.module === 'events' && !route.eventId && (
          <div className="flex-1 flex items-center justify-center text-[13px] text-[var(--color-text-dim)]">
            选择左侧事件查看详情
          </div>
        )}
        {route.module === 'investigations' && route.id && (
          <InvestigationDetailPanel id={route.id} onChanged={bumpRefresh} />
        )}
        {route.module === 'investigations' && !route.id && (
          <div className="flex-1 flex items-center justify-center text-[13px] text-[var(--color-text-dim)]">
            选择左侧调查查看详情
          </div>
        )}
        {route.module === 'patrol' && (
          <PatrolPanel />
        )}
        {route.module === 'knowledge' && (
          <KnowledgePanel />
        )}
        {route.module === 'triggers' && (
          <TriggersPanel />
        )}
        {route.module === 'mcp' && (
          <MCPPanel />
        )}
        {route.module === 'notifications' && (
          <NotificationPanel />
        )}
        {route.module === 'settings' && (
          <SettingsPanel refreshToken={refreshToken} />
        )}
      </main>

      {/* 移动端底部导航栏 */}
      <MobileTabBar active={module} onSelect={handleModuleSelect} hideBar={hasDetail} />
    </div>
    </AuthGuard>
  )
}

function MobileTabBar({ active, onSelect, hideBar }: { active: Module; onSelect: (m: Module) => void; hideBar?: boolean }) {
  const [showMore, setShowMore] = useState(false)

  if (hideBar) return null

  const tabs: { module: Module; label: string; icon: React.ReactNode }[] = [
    { module: 'home', label: '主页', icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5"><path d="M3 12l9-8 9 8" /><path d="M5 10v10a1 1 0 001 1h3v-6h6v6h3a1 1 0 001-1V10" /></svg> },
    { module: 'chat', label: '对话', icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" /></svg> },
    { module: 'events', label: '事件', icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" /></svg> },
    { module: 'investigations', label: '调查', icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5"><circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" /></svg> },
  ]

  const moreItems: { module: Module; label: string }[] = [
    { module: 'knowledge', label: '知识库' },
    { module: 'triggers', label: '触发器' },
    { module: 'mcp', label: '工具' },
    { module: 'notifications', label: '通知' },
    { module: 'settings', label: '设置' },
  ]

  const isMoreActive = moreItems.some((m) => m.module === active)

  return (
    <>
      {/* Bottom sheet 遮罩 + 菜单 */}
      {showMore && (
        <div className="md:hidden fixed inset-0 z-50" onClick={() => setShowMore(false)}>
          <div className="absolute inset-0 bg-black/30" />
          <div className="absolute bottom-0 left-0 right-0 bg-[var(--color-surface)] rounded-t-2xl safe-bottom
            border-t border-[var(--color-border)] orca-fade-in" onClick={(e) => e.stopPropagation()}>
            <div className="w-10 h-1 bg-[var(--color-border-strong)] rounded-full mx-auto mt-2 mb-3" />
            <div className="px-4 pb-4 space-y-1">
              {moreItems.map((m) => (
                <button key={m.module} type="button"
                  onClick={() => { onSelect(m.module); setShowMore(false) }}
                  className={`w-full text-left px-4 py-3 rounded-lg text-[15px] transition-colors
                    ${active === m.module
                      ? 'bg-[var(--color-surface-2)] text-[var(--color-text)] font-medium'
                      : 'text-[var(--color-text-muted)] hover:bg-[var(--color-surface-2)]'}`}>
                  {m.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40
        bg-[var(--color-surface)]/95 backdrop-blur-sm border-t border-[var(--color-border)]
        flex items-center justify-around px-2 py-1.5 safe-bottom">
        {tabs.map((t) => {
          const isActive = active === t.module
          return (
            <button key={t.module} type="button" onClick={() => onSelect(t.module)}
              className={`flex flex-col items-center gap-0.5 py-1 px-3 transition-colors
                ${isActive ? 'text-[var(--color-accent)]' : 'text-[var(--color-text-dim)]'}`}>
              {t.icon}
              <span className="text-[10px]">{t.label}</span>
            </button>
          )
        })}
        <button type="button" onClick={() => setShowMore(!showMore)}
          className={`flex flex-col items-center gap-0.5 py-1 px-3 transition-colors
            ${isMoreActive || showMore ? 'text-[var(--color-accent)]' : 'text-[var(--color-text-dim)]'}`}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className="w-5 h-5">
            <circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /><circle cx="5" cy="12" r="1" />
          </svg>
          <span className="text-[10px]">更多</span>
        </button>
      </nav>
    </>
  )
}

export default App
