import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { ChatMessage } from '../api'
import { ToolCallCard } from './ToolCallCard'
import { InvestigationRefCard } from './InvestigationRefCard'

// ---- User message ----

export function UserMessage({ message }: { message: ChatMessage }) {
  return (
    <div className="flex justify-end mb-6 orca-fade-in">
      <div
        className="max-w-[78%] rounded-lg px-4 py-2.5
          text-[0.9375rem] leading-relaxed
          bg-[var(--color-user-bubble)] text-[var(--color-user-bubble-text)]"
      >
        <p className="whitespace-pre-wrap">{message.content}</p>
      </div>
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
        <span className="font-serif-display text-[15px] text-[var(--color-text-muted)]">orca</span>
      </div>
      <div className="space-y-1" data-assistant-content="true">
        {messages.map((m) => (
          <AssistantSegment key={m.id} message={m} toolOutputs={toolOutputs} />
        ))}
      </div>
    </div>
  )
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
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
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
