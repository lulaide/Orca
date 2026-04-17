import { useState } from 'react'
import type { ToolCall } from '../api'

interface Props {
  toolCall: ToolCall
  output?: string
}

function prettyJSON(s: string): string {
  try {
    return JSON.stringify(JSON.parse(s), null, 2)
  } catch {
    return s
  }
}

export function ToolCallCard({ toolCall, output }: Props) {
  const [open, setOpen] = useState(false)
  const running = output === undefined
  const name = toolCall.function.name
  const isError = !running && output.startsWith('ERROR:')

  const stateLabel = running ? '运行中' : isError ? '失败' : '完成'
  const stateColor = running
    ? 'text-[var(--color-accent)]'
    : isError
    ? 'text-[var(--color-danger)]'
    : 'text-[var(--color-ok)]'

  return (
    <div className="relative my-2 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden orca-fade-in">
      {running && (
        <div className="absolute inset-x-0 top-0 h-[1px] orca-shimmer pointer-events-none" />
      )}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-[var(--color-surface-2)] text-left transition-colors"
      >
        <svg
          viewBox="0 0 24 24"
          className={`w-3 h-3 shrink-0 text-[var(--color-text-dim)] transition-transform ${
            open ? 'rotate-90' : ''
          }`}
          fill="currentColor"
        >
          <path d="M8 5l8 7-8 7V5z" />
        </svg>
        <span className="font-mono text-xs text-[var(--color-text-dim)]">$</span>
        <code className="font-mono text-[12.5px] text-[var(--color-accent)]">{name}</code>
        <span className="flex-1" />
        <span className={`text-[10px] font-mono uppercase tracking-[0.15em] ${stateColor}`}>
          {running && (
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-current mr-1.5 orca-pulse-dot align-middle" />
          )}
          {stateLabel}
        </span>
      </button>
      {open && (
        <div className="px-3 pb-2.5 pt-1 border-t border-[var(--color-border)] space-y-2 orca-fade-in">
          <div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--color-text-dim)] mb-1 font-mono">
              输入
            </div>
            <pre className="bg-[var(--color-bg)] border border-[var(--color-border)] p-2 rounded overflow-x-auto text-[11.5px] font-mono text-[var(--color-text-muted)] leading-[1.55]">
              {prettyJSON(toolCall.function.arguments)}
            </pre>
          </div>
          {!running && (
            <div>
              <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--color-text-dim)] mb-1 font-mono">
                输出
              </div>
              <pre
                className={`bg-[var(--color-bg)] border border-[var(--color-border)] p-2 rounded overflow-x-auto whitespace-pre-wrap text-[11.5px] font-mono leading-[1.55] ${
                  isError ? 'text-[var(--color-danger)]' : 'text-[var(--color-text-muted)]'
                }`}
              >
                {output}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
