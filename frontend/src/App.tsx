import { useEffect, useState } from 'react'
import { AuthGuard } from './components/AuthGuard'
import { IconRail, type Module } from './components/IconRail'
import { SecondaryPanel } from './components/SecondaryPanel'
import { ChatPanel } from './components/ChatPanel'
import { DashboardPanel } from './components/DashboardPanel'
import { HomePanel } from './components/HomePanel'
import { InvestigationDetailPanel } from './components/InvestigationDetailPanel'
import { EventDetailPanel } from './components/EventDetailPanel'
import { TriggersPanel } from './components/TriggersPanel'
import { MCPPanel } from './components/MCPPanel'
import { KnowledgePanel } from './components/KnowledgePanel'
import { SettingsPanel } from './components/SettingsPanel'
import type { InvestigationView, ReferencedInvestigation, AuthStatus } from './api'

// ---- Route 定义 ----

type Route =
  | { module: 'home' }
  | { module: 'chat'; conversationId: string | null }
  | { module: 'events'; eventId: string | null }
  | { module: 'investigations'; id: string | null; view: InvestigationView }
  | { module: 'knowledge'; slug: string | null }
  | { module: 'triggers' }
  | { module: 'mcp' }
  | { module: 'settings' }

function parseRoute(pathname: string, search: string): Route {
  // /settings
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

const MODULES_WITH_PANEL: Module[] = ['chat', 'events', 'investigations', 'knowledge']

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
      triggers: '/triggers',
      mcp: '/mcp',
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

  const handleHomeSubmit = (text: string, refs: ReferencedInvestigation[]) => {
    if (!text.trim()) return
    setPendingInitialMessage(text)
    setPendingInitialRefs(refs)
    nav('/c')
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

  return (
    <AuthGuard onUser={setCurrentUser}>
    <div className="flex w-full h-full bg-[var(--color-bg)]">
      <IconRail active={module} onSelect={handleModuleSelect} username={currentUser?.username} />

      {hasSecondaryPanel && (
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
      )}

      <main className="flex-1 flex flex-col min-w-0 h-full">
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
        {route.module === 'knowledge' && (
          <KnowledgePanel />
        )}
        {route.module === 'triggers' && (
          <TriggersPanel />
        )}
        {route.module === 'mcp' && (
          <MCPPanel />
        )}
        {route.module === 'settings' && (
          <SettingsPanel refreshToken={refreshToken} />
        )}
      </main>
    </div>
    </AuthGuard>
  )
}

export default App
