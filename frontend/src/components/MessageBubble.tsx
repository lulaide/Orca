import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { ChatMessage } from '../api'
import { ToolCallCard } from './ToolCallCard'

interface Props {
  message: ChatMessage
  /** tool_call_id -> output content map，用于把 tool 消息的 content 绑到 assistant.tool_calls */
  toolOutputs: Record<string, string>
}

export function MessageBubble({ message, toolOutputs }: Props) {
  // tool 消息已经消费进 toolOutputs，不单独渲染
  if (message.role === 'tool' || message.role === 'system') {
    return null
  }

  if (message.role === 'user') {
    return (
      <div className="flex justify-end mb-3">
        <div className="max-w-[75%] rounded-lg px-4 py-3 text-sm leading-relaxed bg-blue-600 text-white">
          <p className="whitespace-pre-wrap">{message.content}</p>
        </div>
      </div>
    )
  }

  // assistant
  const hasTools = message.tool_calls && message.tool_calls.length > 0
  const hasText = message.content.length > 0

  return (
    <div className="flex justify-start mb-3">
      <div className="max-w-[85%] w-full rounded-lg px-4 py-3 text-sm leading-relaxed bg-slate-700 text-slate-200">
        {hasTools && (
          <div>
            {message.tool_calls!.map((tc) => (
              <ToolCallCard key={tc.id} toolCall={tc} output={toolOutputs[tc.id]} />
            ))}
          </div>
        )}
        {hasText && (
          <div
            className="prose prose-sm prose-invert max-w-none
              prose-p:my-1 prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5
              prose-headings:text-slate-100 prose-strong:text-slate-100
              prose-code:bg-slate-600 prose-code:px-1 prose-code:rounded
              prose-pre:bg-slate-800 prose-pre:border prose-pre:border-slate-600
              prose-table:text-xs prose-th:px-2 prose-th:py-1 prose-td:px-2 prose-td:py-1
              prose-th:border prose-th:border-slate-600 prose-td:border prose-td:border-slate-600"
          >
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
          </div>
        )}
      </div>
    </div>
  )
}
