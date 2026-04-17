// 小型路由工具：pushState + 手动触发 popstate，让 App 的监听器同步路由状态。
export function navigate(path: string) {
  if (window.location.pathname + window.location.search !== path) {
    window.history.pushState(null, '', path)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }
}
