import { useEffect, useRef, useState } from 'react'
import mermaid from 'mermaid'

let initialized = false

function ensureInit() {
  if (initialized) return
  initialized = true
  mermaid.initialize({
    startOnLoad: false,
    theme: document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'default',
    securityLevel: 'loose',
    fontFamily: 'var(--font-sans)',
  })
}

// 监听主题变化重新初始化
let themeObserver: MutationObserver | null = null
if (typeof window !== 'undefined' && !themeObserver) {
  themeObserver = new MutationObserver(() => {
    initialized = false
  })
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
}

let idCounter = 0

export function MermaidBlock({ code }: { code: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [svg, setSvg] = useState<string>('')
  const [error, setError] = useState<string>('')

  useEffect(() => {
    ensureInit()
    const id = `mermaid-${++idCounter}`
    mermaid.render(id, code.trim()).then(
      (result) => { setSvg(result.svg); setError('') },
      (err) => { setError(String(err)); setSvg('') },
    )
  }, [code])

  if (error) {
    return (
      <pre className="text-[12px] text-[var(--color-danger)] bg-[var(--color-surface-2)] p-3 rounded-lg overflow-x-auto">
        {error}
      </pre>
    )
  }

  return (
    <div
      ref={ref}
      className="my-4 flex justify-center overflow-x-auto"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  )
}
