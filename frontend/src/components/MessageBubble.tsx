import { useState, useCallback, useEffect } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { createHighlighter, type Highlighter } from 'shiki'
import type { ChatMessage } from '../api'

// 全局单例 highlighter，懒加载
let highlighterPromise: Promise<Highlighter> | null = null
const loadedLangs = new Set<string>()

function getHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      themes: ['github-light', 'github-dark'],
      langs: ['javascript', 'typescript', 'python', 'go', 'bash', 'json', 'yaml', 'sql', 'html', 'css', 'markdown', 'dockerfile', 'shell'],
    }).then((h) => {
      for (const lang of ['javascript', 'typescript', 'python', 'go', 'bash', 'json', 'yaml', 'sql', 'html', 'css', 'markdown', 'dockerfile', 'shell']) {
        loadedLangs.add(lang)
      }
      return h
    })
  }
  return highlighterPromise
}
import { MermaidBlock } from './MermaidBlock'
import { ToolCallCard } from './ToolCallCard'
import { InvestigationRefCard } from './InvestigationRefCard'
import { InvestigationReferenceCard } from './InvestigationReferenceCard'

// ---- User message ----

export function UserMessage({ message }: { message: ChatMessage }) {
  const refs = message.metadata?.referenced_investigations ?? []
  return (
    <div className="flex flex-col items-end mb-6 orca-fade-in">
      {refs.length > 0 && (
        <div className="max-w-[78%] w-full flex flex-col gap-1.5 mb-1.5 items-end">
          {refs.map((r) => (
            <div key={r.id} className="w-full max-w-[420px]">
              <InvestigationReferenceCard inv={r} />
            </div>
          ))}
        </div>
      )}
      {message.content && (
        <div
          className="max-w-[78%] rounded-lg px-4 py-2.5
            text-[0.9375rem] leading-relaxed
            bg-[var(--color-user-bubble)] text-[var(--color-user-bubble-text)]"
        >
          <p className="whitespace-pre-wrap">{message.content}</p>
        </div>
      )}
    </div>
  )
}

// ---- Assistant turn: 一轮 LLM run 里所有 assistant 消息共用一个左侧 accent bar ----

interface AssistantTurnProps {
  messages: ChatMessage[]
  toolOutputs: Record<string, string>
}

export function AssistantTurn({ messages, toolOutputs }: AssistantTurnProps) {
  return (
    <div className="mb-7 orca-fade-in pl-4 border-l-2 border-[var(--color-accent)]/60">
      <div className="flex items-center gap-2 mb-2 -ml-[22px]">
        <span className="w-4 h-4 rounded-full bg-[var(--color-bg)] border-2 border-[var(--color-accent)] shadow-[0_0_0_3px_var(--color-bg)]" />
        <span className="font-semibold text-[15px] text-[var(--color-text-muted)]">orca</span>
      </div>
      <div className="space-y-1" data-assistant-content="true">
        {messages.map((m) => (
          <AssistantSegment key={m.id} message={m} toolOutputs={toolOutputs} />
        ))}
      </div>
    </div>
  )
}

// 代码块复制按钮
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }, [text])

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="code-copy-btn"
      title="复制代码"
    >
      {copied ? (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
          <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
        </svg>
      )}
      <span className="text-[11px]">{copied ? '已复制' : '复制'}</span>
    </button>
  )
}

// 提取代码块纯文本
function extractText(node: React.ReactNode): string {
  if (typeof node === 'string') return node
  if (Array.isArray(node)) return node.map(extractText).join('')
  if (node && typeof node === 'object' && 'props' in node) {
    return extractText((node as React.ReactElement<{ children?: React.ReactNode }>).props.children)
  }
  return ''
}

// 读取当前主题
function currentTheme(): 'github-light' | 'github-dark' {
  return document.documentElement.getAttribute('data-theme') === 'dark'
    ? 'github-dark'
    : 'github-light'
}

// 高亮代码块
function HighlightedCode({ code, lang }: { code: string; lang: string }) {
  const [html, setHtml] = useState<string | null>(null)
  const [theme, setTheme] = useState(currentTheme)

  // 监听主题变化
  useEffect(() => {
    const observer = new MutationObserver(() => setTheme(currentTheme()))
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    let cancelled = false
    getHighlighter().then(async (h) => {
      if (cancelled) return
      if (!loadedLangs.has(lang)) {
        try {
          await h.loadLanguage(lang as never)
          loadedLangs.add(lang)
        } catch {
          if (!cancelled) setHtml('')
          return
        }
      }
      if (cancelled) return
      const result = h.codeToHtml(code, { lang, theme })
      setHtml(result)
    })
    return () => { cancelled = true }
  }, [code, lang, theme])

  if (html === null) return <code>{code}</code>
  if (html === '') return <code>{code}</code>
  return <div className="shiki-wrapper" dangerouslySetInnerHTML={{ __html: html }} />
}

// 自定义 Markdown 组件：代码块加语言标签 + 复制按钮 + 语法高亮
const markdownComponents: Components = {
  pre({ children, ...props }) {
    const text = extractText(children).replace(/\n$/, '')
    // 检查子元素是否是有语言的 code 块（HighlightedCode 会自带 pre）
    let lang: string | null = null
    if (children && typeof children === 'object' && 'props' in children) {
      const child = children as React.ReactElement<{ className?: string }>
      const match = /language-(\w+)/.exec(child.props.className || '')
      if (match) lang = match[1]
    }
    if (lang === 'mermaid') {
      return <MermaidBlock code={text} />
    }
    if (lang) {
      // shiki 输出自带 pre，外层改用 div
      return (
        <div className="code-block-wrapper">
          <span className="code-lang-label">{lang}</span>
          <CopyButton text={text} />
          <HighlightedCode code={text} lang={lang} />
        </div>
      )
    }
    return (
      <pre {...props}>
        <CopyButton text={text} />
        {children}
      </pre>
    )
  },
  table({ children, ...props }) {
    return <div className="overflow-x-auto -mx-2 px-2"><table {...props}>{children}</table></div>
  },
  code({ className, children, ...props }) {
    const match = /language-(\w+)/.exec(className || '')
    // 块级代码由 pre 组件处理高亮，这里只处理行内代码
    if (match) {
      return <code className={className} {...props}>{children}</code>
    }
    return <code className={className} {...props}>{children}</code>
  },
}

function AssistantSegment({
  message,
  toolOutputs,
}: {
  message: ChatMessage
  toolOutputs: Record<string, string>
}) {
  const hasText = message.content.length > 0
  const hasTools = message.tool_calls && message.tool_calls.length > 0

  return (
    <div>
      {hasText && (
        <div className="orca-prose mb-1">
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
            {message.content}
          </ReactMarkdown>
        </div>
      )}
      {hasTools && (
        <div>
          {message.tool_calls!.map((tc) =>
            tc.function.name === 'create_investigation' ? (
              <InvestigationRefCard key={tc.id} toolCall={tc} output={toolOutputs[tc.id]} />
            ) : (
              <ToolCallCard key={tc.id} toolCall={tc} output={toolOutputs[tc.id]} />
            ),
          )}
        </div>
      )}
    </div>
  )
}
