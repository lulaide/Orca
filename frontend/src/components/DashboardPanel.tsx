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
      <div className="max-w-5xl mx-auto px-8 py-8">
        {/* 页面标题 */}
        <div className="mb-8">
          <h1 className="font-serif-display text-[36px] leading-tight text-[var(--color-text)]">
            Dashboard
          </h1>
          <p className="text-[13px] text-[var(--color-text-muted)] mt-1">
            集群概览与运维态势
          </p>
        </div>

        {/* 状态卡片行 */}
        <div className="grid grid-cols-3 gap-4 mb-8">
          {/* 连接状态 */}
          <StatusCard>
            <CardHeader>系统状态</CardHeader>
            <div className="space-y-2.5 mt-3">
              <StatusRow
                label="LLM"
                ok={llmOk}
                detail={llmOk ? `${status!.llm.provider} / ${status!.llm.model}` : '未配置'}
              />
              <StatusRow
                label="K8s"
                ok={kubeOk}
                detail={kubeOk ? `${status!.kubernetes.mode} / ${status!.kubernetes.server_version}` : '未连接'}
              />
              <StatusRow
                label="工具"
                ok={(status?.tools.length ?? 0) > 0}
                detail={`${status?.tools.length ?? 0} 个就绪`}
              />
            </div>
          </StatusCard>

          {/* 集群资源 */}
          <StatusCard>
            <CardHeader>集群资源</CardHeader>
            {metrics && kubeOk ? (
              <div className="space-y-2.5 mt-3">
                <MetricRow label="CPU" used={metrics.cpu.usage} total={metrics.cpu.allocatable} unit="cores" />
                <MetricRow label="内存" used={metrics.memory.usage ? metrics.memory.usage / (1024 ** 3) : null} total={metrics.memory.allocatable / (1024 ** 3)} unit="GiB" />
                <MetricRow label="Pod" used={metrics.pods.usage} total={metrics.pods.allocatable} unit="" />
              </div>
            ) : (
              <div className="mt-3 text-[12px] text-[var(--color-text-dim)] italic">
                {kubeOk ? '加载中…' : 'K8s 未连接'}
              </div>
            )}
          </StatusCard>

          {/* 快捷操作 */}
          <StatusCard>
            <CardHeader>快捷操作</CardHeader>
            <div className="space-y-1.5 mt-3">
              <QuickAction label="新对话" desc="向 Agent 提问" onClick={() => navigate('/c')} />
              <QuickAction label="扫描集群" desc="生成知识库文档" onClick={() => navigate('/knowledge?scan=1')} />
              <QuickAction label="配置 LLM" desc="设置 API 密钥" onClick={() => navigate('/settings')} />
            </div>
          </StatusCard>
        </div>

        {/* 下半部分：事件 + 调查 */}
        <div className="grid grid-cols-2 gap-6">
          {/* 最近事件 */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <SectionHeader>最近事件</SectionHeader>
              <button type="button" onClick={() => navigate('/events')}
                className="text-[11px] font-mono text-[var(--color-accent)] hover:underline">
                查看全部 →
              </button>
            </div>
            {events.length === 0 ? (
              <div className="text-[12.5px] text-[var(--color-text-dim)] italic py-4">暂无事件</div>
            ) : (
              <div className="space-y-1">
                {events.map((ev) => (
                  <button
                    key={ev.id}
                    type="button"
                    onClick={() => navigate(`/events/${ev.id}`)}
                    className="w-full text-left flex items-center gap-2 px-3 py-2 rounded-md
                      hover:bg-[var(--color-surface)] transition-colors text-[12.5px]"
                  >
                    <SeverityDot severity={ev.severity} />
                    <span className="flex-1 truncate text-[var(--color-text)]">{ev.title}</span>
                    {!ev.processed_at && (
                      <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-warn)] shrink-0" />
                    )}
                    <span className="text-[10px] text-[var(--color-text-dim)] font-mono shrink-0">
                      {formatRelativeTime(ev.created_at)}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* 活跃调查 */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <SectionHeader>活跃调查</SectionHeader>
              <button type="button" onClick={() => navigate('/i')}
                className="text-[11px] font-mono text-[var(--color-accent)] hover:underline">
                查看全部 →
              </button>
            </div>
            {investigations.length === 0 ? (
              <div className="text-[12.5px] text-[var(--color-text-dim)] italic py-4">暂无进行中的调查</div>
            ) : (
              <div className="space-y-1">
                {investigations.map((inv) => (
                  <button
                    key={inv.id}
                    type="button"
                    onClick={() => navigate(`/i/${inv.id}`)}
                    className="w-full text-left flex items-center gap-2 px-3 py-2 rounded-md
                      hover:bg-[var(--color-surface)] transition-colors text-[12.5px]"
                  >
                    <SeverityDot severity={inv.severity} />
                    <span className="flex-1 truncate text-[var(--color-text)]">{inv.title}</span>
                    <StatusBadge status={inv.status} />
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ---- 子组件 ----

function StatusCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]/50 p-4">
      {children}
    </div>
  )
}

function CardHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10.5px] font-mono uppercase tracking-[0.2em] text-[var(--color-text-dim)]">
      {children}
    </div>
  )
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[11px] font-mono uppercase tracking-[0.18em] text-[var(--color-text-dim)]">
      {children}
    </span>
  )
}

function StatusRow({ label, ok, detail }: { label: string; ok: boolean; detail: string }) {
  return (
    <div className="flex items-center gap-2 text-[12px]">
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
        ok ? 'bg-[var(--color-ok)]' : 'bg-[var(--color-warn)]'
      }`} />
      <span className="text-[var(--color-text-muted)] font-mono w-8 shrink-0">{label}</span>
      <span className="text-[var(--color-text)] truncate">{detail}</span>
    </div>
  )
}

function MetricRow({ label, used, total, unit }: { label: string; used: number | null; total: number; unit: string }) {
  const pct = used != null ? Math.round((used / total) * 100) : null
  return (
    <div className="text-[12px]">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[var(--color-text-muted)]">{label}</span>
        <span className="text-[var(--color-text)] font-mono text-[11px]">
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
        border border-[var(--color-border)] hover:border-[var(--color-accent)]
        hover:bg-[var(--color-accent-soft)] transition-colors"
    >
      <div>
        <div className="text-[13px] text-[var(--color-text)]">{label}</div>
        <div className="text-[11px] text-[var(--color-text-dim)]">{desc}</div>
      </div>
      <span className="ml-auto text-[var(--color-text-dim)] text-[11px]">→</span>
    </button>
  )
}
