import { useEffect, useState } from 'react'
import { Sidebar } from './components/Sidebar'
import { ChatPanel } from './components/ChatPanel'
import { HomePanel } from './components/HomePanel'
import { InvestigationListPanel } from './components/InvestigationListPanel'
import { InvestigationDetailPanel } from './components/InvestigationDetailPanel'
import type { InvestigationView } from './api'

type Route =
  | { kind: 'home' }
  | { kind: 'chat'; conversationId: string | null }
  | { kind: 'investigation'; id: string }
  | { kind: 'investigation-list'; view: InvestigationView }

function parseConversationId(pathname: string): string | null {
  const m = pathname.match(/^\/c\/([A-Za-z0-9_-]{6,})$/)
  return m ? m[1] : null
}

function parseRoute(pathname: string, search: string): Route {
  const invDetail = pathname.match(/^\/i\/([A-Za-z0-9_-]{6,})$/)
  if (invDetail) return { kind: 'investigation', id: invDetail[1] }
  if (pathname === '/i' || pathname === '/i/') {
    const sp = new URLSearchParams(search)
    const v = sp.get('view') as InvestigationView | null
    const view: InvestigationView =
      v === 'active' || v === 'resolved' || v === 'archived' || v === 'all' ? v : 'active'
    return { kind: 'investigation-list', view }
  }
  const convId = parseConversationId(pathname)
  if (convId) return { kind: 'chat', conversationId: convId }
  if (pathname === '/' || pathname === '') return { kind: 'home' }
  // 未知路径回退到 home
  return { kind: 'home' }
}

function urlForConv(id: string | null): string {
  return id ? `/c/${id}` : '/'
}

function App() {
  const [route, setRoute] = useState<Route>(() =>
    parseRoute(window.location.pathname, window.location.search),
  )
  const [refreshToken, setRefreshToken] = useState(0)
  // 首页输入框提交的首条消息，暂存到 ChatPanel 拿到之后自动发
  const [pendingInitialMessage, setPendingInitialMessage] = useState<string | null>(null)
  // sidebar "+ 新对话" 点击时递增，HomePanel 据此聚焦输入框
  const [homeFocusToken, setHomeFocusToken] = useState(0)

  const bumpRefresh = () => setRefreshToken((v) => v + 1)

  // 浏览器前进/后退或手动 navigate 时同步状态
  useEffect(() => {
    const onPop = () => setRoute(parseRoute(window.location.pathname, window.location.search))
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  // 侧栏切换对话（null → 回到首页）
  const handleSelectConversation = (id: string | null) => {
    if (id === null) {
      setRoute({ kind: 'home' })
      if (window.location.pathname + window.location.search !== '/') {
        window.history.pushState(null, '', '/')
      }
      setHomeFocusToken((t) => t + 1)
      return
    }
    const next = urlForConv(id)
    setRoute({ kind: 'chat', conversationId: id })
    if (window.location.pathname + window.location.search !== next) {
      window.history.pushState(null, '', next)
    }
  }

  // Home 输入框提交 → 打开空 chat 面板 + 自动发首条
  const handleHomeSubmit = (text: string) => {
    const t = text.trim()
    if (!t) return
    setPendingInitialMessage(t)
    setRoute({ kind: 'chat', conversationId: null })
    // 保持 URL 为 /，等 conversation_id 回来后在 onConversationCreated 里 replaceState
  }

  // 首次发送消息后后端回填的 id → 不新增历史项，替换当前
  const handleConversationCreated = (id: string) => {
    setRoute({ kind: 'chat', conversationId: id })
    window.history.replaceState(null, '', urlForConv(id))
    bumpRefresh()
  }

  const activeConversationId = route.kind === 'chat' ? route.conversationId : null

  return (
    <div className="flex w-full h-full bg-[var(--color-bg)]">
      <Sidebar
        activeId={activeConversationId}
        onSelect={handleSelectConversation}
        refreshToken={refreshToken}
        route={route}
      />
      <main className="flex-1 flex flex-col min-w-0 h-full">
        {route.kind === 'home' && (
          <HomePanel
            onSubmit={handleHomeSubmit}
            focusSignal={homeFocusToken}
          />
        )}
        {route.kind === 'chat' && (
          <ChatPanel
            conversationId={route.conversationId}
            onConversationCreated={handleConversationCreated}
            onConversationUpdated={bumpRefresh}
            initialMessage={pendingInitialMessage}
            onInitialMessageConsumed={() => setPendingInitialMessage(null)}
          />
        )}
        {route.kind === 'investigation-list' && (
          <InvestigationListPanel
            view={route.view}
            refreshToken={refreshToken}
            onChanged={bumpRefresh}
          />
        )}
        {route.kind === 'investigation' && (
          <InvestigationDetailPanel id={route.id} onChanged={bumpRefresh} />
        )}
      </main>
    </div>
  )
}

export default App
