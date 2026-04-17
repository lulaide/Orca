import { useState } from 'react'
import type { ToolCall } from '../api'

interface Props {
  toolCall: ToolCall
  output?: string // 匹配 tool_call_id 的 tool 消息 content，未返回时为 undefined
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

  return (
    <div className="border border-slate-600 rounded-md bg-slate-800/60 my-2 text-xs">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-slate-700/50 text-left"
      >
        <span className="text-slate-400 w-3 shrink-0">{open ? '▼' : '▶'}</span>
        <span className="font-mono text-amber-400">{name}</span>
        <span className="ml-auto text-slate-500">
          {running ? 'running…' : isError ? 'error' : 'done'}
        </span>
      </button>
      {open && (
        <div className="px-3 py-2 border-t border-slate-600 space-y-2">
          <div>
            <div className="text-slate-500 mb-1">Input</div>
            <pre className="bg-slate-900 p-2 rounded overflow-x-auto text-slate-300">
              {prettyJSON(toolCall.function.arguments)}
            </pre>
          </div>
          {!running && (
            <div>
              <div className="text-slate-500 mb-1">Output</div>
              <pre
                className={`bg-slate-900 p-2 rounded overflow-x-auto whitespace-pre-wrap ${
                  isError ? 'text-red-400' : 'text-slate-300'
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
