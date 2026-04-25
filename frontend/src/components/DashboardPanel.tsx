import { useEffect, useState } from 'react'
import {
  getStatus,
  getClusterMetrics,
  listEvents,
  listInvestigations,
  type StatusResponse,
  type ClusterMetrics,
  type OrcaEvent,
  type Investigation,
} from '../api'
import { navigate } from '../navigate'
import { SeverityDot, StatusBadge } from './investigationUI'
import { formatRelativeTime } from '../timeFormat'

export function DashboardPanel() {
  const [status, setStatus] = useState<StatusResponse | null>(null)
  const [metrics, setMetrics] = useState<ClusterMetrics | null>(null)
  const [events, setEvents] = useState<OrcaEvent[]>([])
  const [investigations, setInvestigations] = useState<Investigation[]>([])

  useEffect(() => {
    getStatus().then(setStatus).catch(() => {})
    getClusterMetrics().then(setMetrics).catch(() => {})
    listEvents({ limit: 5 }).then(setEvents).catch(() => {})
    listInvestigations({ view: 'active' }).then((list) => setInvestigations(list.slice(0, 5))).catch(() => {})
  }, [])

  const kubeOk = !!status?.kubernetes.connected
  const llmOk = !!status?.llm.configured

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-5xl mx-auto px-4 py-6 md:px-8 md:py-8 pb-20 md:pb-8">
        <h1 className="text-[22px] font-semibold text-[var(--color-text)] mb-6">Dashboard</h1>

        {/* 顶部卡片行 */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          {/* 系统状态 */}
          <Card title="系统状态">
            <div className="space-y-3">
              <StatusRow label="LLM" ok={llmOk}
                detail={llmOk ? `${status!.llm.provider} / ${status!.llm.model}` : '未配置'} />
              <StatusRow label="K8s" ok={kubeOk}
                detail={kubeOk ? `${status!.kubernetes.mode} / ${status!.kubernetes.server_version}` : '未连接'} />
              <StatusRow label="工具" ok={(status?.tools.length ?? 0) > 0}
                detail={`${status?.tools.length ?? 0} 个就绪`} />
            </div>
          </Card>

          {/* 集群资源 */}
          <Card title="集群资源">
            {metrics && kubeOk ? (
              <div className="space-y-3">
                <MetricRow label="CPU" used={metrics.cpu.usage} total={metrics.cpu.allocatable} unit="cores" />
                <MetricRow label="内存" used={metrics.memory.usage ? metrics.memory.usage / (1024 ** 3) : null} total={metrics.memory.allocatable / (1024 ** 3)} unit="GiB" />
                <MetricRow label="Pod" used={metrics.pods.usage} total={metrics.pods.allocatable} unit="" />
              </div>
            ) : (
              <div className="text-[13px] text-[var(--color-text-dim)]">
                {kubeOk ? '加载中…' : 'K8s 未连接'}
              </div>
            )}
          </Card>

          {/* 快捷操作 */}
          <Card title="快捷操作">
            <div className="space-y-1.5">
              <QuickAction label="新对话" desc="向 Agent 提问" onClick={() => navigate('/c')} />
              <QuickAction label="扫描集群" desc="生成知识库文档" onClick={() => navigate('/knowledge?scan=1')} />
              <QuickAction label="配置 LLM" desc="设置 API 密钥" onClick={() => navigate('/settings')} />
            </div>
          </Card>
        </div>

        {/* 下半部分：事件 + 调查（带边框卡片） */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card title="最近事件" count={events.length}
            action={events.length > 0 ? { label: '查看全部', onClick: () => navigate('/events') } : undefined}>
            {events.length === 0 ? (
              <div className="text-[13px] text-[var(--color-text-dim)] py-3">暂无事件</div>
            ) : (
              <div className="-mx-4">
                {events.map((ev, i) => (
                  <button
                    key={ev.id}
                    type="button"
                    onClick={() => navigate(`/events/${ev.id}`)}
                    className={`w-full text-left flex items-center gap-3 px-4 py-2.5
                      hover:bg-[var(--color-surface-2)] transition-colors text-[13px]
                      ${i > 0 ? 'border-t border-[var(--color-border)]' : ''}`}
                  >
                    <SeverityDot severity={ev.severity} />
                    <span className="flex-1 truncate text-[var(--color-text)]">{ev.title}</span>
                    {!ev.processed_at && (
                      <span className="text-[11px] font-medium text-[var(--color-warn)]">pending</span>
                    )}
                    <span className="text-[12px] text-[var(--color-text-dim)] shrink-0">
                      {formatRelativeTime(ev.created_at)}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </Card>

          <Card title="活跃调查" count={investigations.length}
            action={investigations.length > 0 ? { label: '查看全部', onClick: () => navigate('/i') } : undefined}>
            {investigations.length === 0 ? (
              <div className="text-[13px] text-[var(--color-text-dim)] py-3">暂无进行中的调查</div>
            ) : (
              <div className="-mx-4">
                {investigations.map((inv, i) => (
                  <button
                    key={inv.id}
                    type="button"
                    onClick={() => navigate(`/i/${inv.id}`)}
                    className={`w-full text-left flex items-center gap-3 px-4 py-2.5
                      hover:bg-[var(--color-surface-2)] transition-colors text-[13px]
                      ${i > 0 ? 'border-t border-[var(--color-border)]' : ''}`}
                  >
                    <SeverityDot severity={inv.severity} />
                    <span className="flex-1 truncate text-[var(--color-text)]">{inv.title}</span>
                    <StatusBadge status={inv.status} />
                  </button>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  )
}

// ---- 子组件 ----

function Card({ title, count, action, children }: {
  title: string
  count?: number
  action?: { label: string; onClick: () => void }
  children: React.ReactNode
}) {
  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)]">
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border)]">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-medium text-[var(--color-text)]">{title}</span>
          {count != null && count > 0 && (
            <span className="text-[11px] font-medium text-[var(--color-text-dim)] bg-[var(--color-surface-2)]
              px-1.5 py-0.5 rounded-full tabular-nums">{count}</span>
          )}
        </div>
        {action && (
          <button type="button" onClick={action.onClick}
            className="orca-btn-link text-[13px]">
            {action.label} →
          </button>
        )}
      </div>
      <div className="p-4">{children}</div>
    </div>
  )
}

function StatusRow({ label, ok, detail }: { label: string; ok: boolean; detail: string }) {
  return (
    <div className="flex items-center gap-2.5 text-[13px]">
      <span className={`w-2 h-2 rounded-full shrink-0 ${
        ok ? 'bg-[var(--color-ok)]' : 'bg-[var(--color-warn)]'
      }`} />
      <span className="text-[var(--color-text-muted)] w-8 shrink-0">{label}</span>
      <span className="text-[var(--color-text)] truncate">{detail}</span>
    </div>
  )
}

function MetricRow({ label, used, total, unit }: { label: string; used: number | null; total: number; unit: string }) {
  const pct = used != null ? Math.round((used / total) * 100) : null
  return (
    <div>
      <div className="flex items-center justify-between mb-1 text-[13px]">
        <span className="text-[var(--color-text-muted)]">{label}</span>
        <span className="text-[var(--color-text)] font-mono text-[12px]">
          {used != null ? `${used.toFixed(1)}` : '?'} / {total.toFixed(1)} {unit}
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-[var(--color-surface-2)] overflow-hidden">
        {pct != null && (
          <div
            className={`h-full rounded-full transition-all ${
              pct > 80 ? 'bg-[var(--color-danger)]' : pct > 60 ? 'bg-[var(--color-warn)]' : 'bg-[var(--color-ok)]'
            }`}
            style={{ width: `${Math.min(pct, 100)}%` }}
          />
        )}
      </div>
    </div>
  )
}

function QuickAction({ label, desc, onClick }: { label: string; desc: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-left flex items-center gap-3 px-3 py-2 rounded-md
        hover:bg-[var(--color-surface-2)] transition-colors group"
    >
      <div className="flex-1">
        <div className="text-[13px] text-[var(--color-text)]">{label}</div>
        <div className="text-[12px] text-[var(--color-text-dim)]">{desc}</div>
      </div>
      <span className="text-[var(--color-text-dim)] group-hover:text-[var(--color-text)] transition-colors">→</span>
    </button>
  )
}
