import { useEffect, useState } from 'react'
import { getStatus, type StatusResponse } from '../api'

export function StatusBar() {
  const [status, setStatus] = useState<StatusResponse | null>(null)

  useEffect(() => {
    getStatus().then(setStatus).catch(console.error)
    const timer = setInterval(() => {
      getStatus().then(setStatus).catch(console.error)
    }, 30000)
    return () => clearInterval(timer)
  }, [])

  return (
    <div className="flex items-center gap-4 px-4 py-2 bg-slate-800 border-b border-slate-700 text-sm">
      <span className="font-semibold text-slate-200">Orca</span>
      <div className="flex items-center gap-1.5">
        <span
          className={`w-2 h-2 rounded-full ${status?.llm.configured ? 'bg-green-400' : 'bg-red-400'}`}
        />
        <span className="text-slate-400">
          LLM: {status?.llm.configured
            ? `${status.llm.provider} / ${status.llm.model}`
            : 'Not configured'}
        </span>
      </div>
      <div className="flex items-center gap-1.5">
        <span
          className={`w-2 h-2 rounded-full ${status?.kubernetes.connected ? 'bg-green-400' : 'bg-yellow-400'}`}
        />
        <span className="text-slate-400">
          K8s: {status?.kubernetes.connected
            ? `${status.kubernetes.mode} (${status.kubernetes.server_version})`
            : status?.kubernetes.mode === 'unset' ? 'Not configured' : 'Disconnected'}
        </span>
      </div>
      {status?.tools && (
        <span className="text-slate-500 ml-auto">
          {status.tools.length} tools
        </span>
      )}
    </div>
  )
}
