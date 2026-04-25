import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { ChatMessage } from '../api'
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

// 自定义 Markdown 组件：代码块加语言标签
const markdownComponents: Components = {
  pre({ children, ...props }) {
    return <pre {...props}>{children}</pre>
  },
  table({ children, ...props }) {
    return <div className="overflow-x-auto -mx-2 px-2"><table {...props}>{children}</table></div>
  },
  code({ className, children, ...props }) {
    const match = /language-(\w+)/.exec(className || '')
    // 块级代码（在 pre 内）
    if (match) {
      return (
        <>
          <span className="code-lang-label">{match[1]}</span>
          <code className={className} {...props}>{children}</code>
        </>
      )
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
