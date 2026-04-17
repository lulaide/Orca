import { useEffect, useState } from 'react'
import { Sidebar } from './components/Sidebar'
import { ChatPanel } from './components/ChatPanel'

function parseConversationId(pathname: string): string | null {
  const m = pathname.match(/^\/c\/([A-Za-z0-9_-]{6,})$/)
  return m ? m[1] : null
}

function urlFor(id: string | null): string {
  return id ? `/c/${id}` : '/'
}

function App() {
  const [conversationId, setConversationId] = useState<string | null>(() =>
    parseConversationId(window.location.pathname),
  )
  const [refreshToken, setRefreshToken] = useState(0)

  const bumpRefresh = () => setRefreshToken((v) => v + 1)

  // 浏览器前进/后退时同步状态
  useEffect(() => {
    const onPop = () => setConversationId(parseConversationId(window.location.pathname))
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  // 用户在侧栏主动切换 → 压入历史
  const handleSelect = (id: string | null) => {
    setConversationId(id)
    const next = urlFor(id)
    if (window.location.pathname !== next) {
      window.history.pushState(null, '', next)
    }
  }

  // 首次发送消息后后端回填的 id → 不新增历史项，替换当前
  const handleConversationCreated = (id: string) => {
    setConversationId(id)
    window.history.replaceState(null, '', urlFor(id))
    bumpRefresh()
  }

  return (
    <div className="flex w-full h-full bg-[var(--color-bg)]">
      <Sidebar activeId={conversationId} onSelect={handleSelect} refreshToken={refreshToken} />
      <main className="flex-1 flex flex-col min-w-0 h-full">
        <ChatPanel
          conversationId={conversationId}
          onConversationCreated={handleConversationCreated}
          onConversationUpdated={bumpRefresh}
        />
      </main>
    </div>
  )
}

export default App
