// Minimal theme helper: light (default) / dark, persisted in localStorage.
// 通过在 <html> 上设置 data-theme 切换 CSS 变量。

export type Theme = 'light' | 'dark'

const KEY = 'orca.theme'

export function getInitialTheme(): Theme {
  try {
    const saved = localStorage.getItem(KEY)
    if (saved === 'light' || saved === 'dark') return saved
  } catch {
    // ignore
  }
  return 'light' // 默认亮色
}

export function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute('data-theme', theme)
  try {
    localStorage.setItem(KEY, theme)
  } catch {
    // ignore
  }
}
