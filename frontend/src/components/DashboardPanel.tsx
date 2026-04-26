import { useEffect, useState } from 'react'
import {
  getStatus,
  getClusterOverview,
  listEvents,
  listInvestigations,
  type StatusResponse,
  type ClusterOverview,
  type OrcaEvent,
  type Investigation,
  type WorkloadCounts,
} from '../api'
import { navigate } from '../navigate'
import { SeverityDot, StatusBadge } from './investigationUI'
import { formatRelativeTime } from '../timeFormat'

export function DashboardPanel() {
  const [status, setStatus] = useState<StatusResponse | null>(null)
  const [overview, setOverview] = useState<ClusterOverview | null>(null)
  const [events, setEvents] = useState<OrcaEvent[]>([])
  const [investigations, setInvestigations] = useState<Investigation[]>([])

  useEffect(() => {
    const load = () => {
      getStatus().then(setStatus).catch(() => {})
      getClusterOverview().then(setOverview).catch(() => {})
      listEvents({ limit: 5 }).then(setEvents).catch(() => {})
      listInvestigations({ view: 'active' }).then((list) => setInvestigations(list.slice(0, 5))).catch(() => {})
    }
    load()
    const t = setInterval(load, 30000)
    return () => clearInterval(t)
  }, [])

  const kubeOk = !!status?.kubernetes.connected
  const llmOk = !!status?.llm.configured

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-6xl mx-auto px-4 py-6 md:px-8 md:py-8 pb-20 md:pb-8 space-y-5">
        <h1 className="text-[22px] font-semibold text-[var(--color-text)]">Dashboard</h1>

        {/* Row 1: 系统状态 + 集群资源 + 快捷操作 */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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

          <Card title="集群资源">
            {overview && kubeOk ? (
              <div className="space-y-3">
                <MetricRow label="CPU" used={overview.cpu.usage} total={overview.cpu.allocatable} unit="cores" />
                <MetricRow label="内存" used={overview.memory.usage ? overview.memory.usage / (1024 ** 3) : null} total={overview.memory.allocatable / (1024 ** 3)} unit="GiB" />
                <MetricRow label="Pod" used={overview.pods.usage} total={overview.pods.allocatable} unit="" />
              </div>
            ) : (
              <div className="text-[13px] text-[var(--color-text-dim)]">
                {kubeOk ? '加载中…' : 'K8s 未连接'}
              </div>
            )}
          </Card>

          <Card title="快捷操作">
            <div className="space-y-1.5">
              <QuickAction label="新对话" desc="向 Agent 提问" onClick={() => navigate('/c')} />
              <QuickAction label="扫描集群" desc="生成知识库文档" onClick={() => navigate('/knowledge?scan=1')} />
              <QuickAction label="配置 LLM" desc="设置 API 密钥" onClick={() => navigate('/settings')} />
            </div>
          </Card>
        </div>

        {/* Row 2: 节点状态 */}
        {overview && kubeOk && (overview.node_details?.length ?? 0) > 0 && (
          <div>
            <SectionTitle>节点状态</SectionTitle>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {overview.node_details.map((node) => (
                <div key={node.name}
                  className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-4 py-3">
                  <div className="flex items-center gap-2 mb-3">
                    <span className={`w-2 h-2 rounded-full shrink-0 ${node.ready ? 'bg-[var(--color-ok)]' : 'bg-[var(--color-danger)]'}`} />
                    <span className="text-[13px] font-medium text-[var(--color-text)] truncate">{node.name}</span>
                    {node.conditions.length > 0 && node.conditions.map((c) => (
                      <span key={c} className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--color-danger)]/10 text-[var(--color-danger)]">{c}</span>
                    ))}
                  </div>
                  <div className="space-y-2">
                    <MetricRow label="CPU" used={node.cpu_usage} total={node.cpu_allocatable} unit="cores" />
                    <MetricRow label="内存" used={node.mem_usage ? node.mem_usage / (1024 ** 3) : null} total={node.mem_allocatable / (1024 ** 3)} unit="GiB" />
                    <div className="flex items-center justify-between text-[12px] text-[var(--color-text-dim)]">
                      <span>Pod</span>
                      <span className="font-mono">{node.pod_count} / {node.pod_capacity}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Row 3: 工作负载 + 异常 Pod */}
        {overview && kubeOk && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card title="工作负载">
              <div className="space-y-3">
                <WorkloadRow label="Deployment" counts={overview.workloads.deployments} />
                <WorkloadRow label="StatefulSet" counts={overview.workloads.statefulsets} />
                <WorkloadRow label="DaemonSet" counts={overview.workloads.daemonsets} />
              </div>
            </Card>

            <Card title="异常 Pod">
              {(overview.problem_pods?.length ?? 0) === 0 ? (
                <div className="flex items-center gap-2 py-2">
                  <span className="w-2 h-2 rounded-full bg-[var(--color-ok)]" />
                  <span className="text-[13px] text-[var(--color-ok)]">一切正常</span>
                </div>
              ) : (
                <div className="space-y-2">
                  {(overview.problem_pods ?? []).slice(0, 8).map((pp) => (
                    <div key={`${pp.namespace}/${pp.name}`} className="flex items-start gap-2 text-[12px]">
                      <span className="w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 bg-[var(--color-danger)]" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="text-[var(--color-text)] font-medium truncate">{pp.name}</span>
                          <span className="text-[var(--color-text-dim)] shrink-0">{pp.namespace}</span>
                        </div>
                        <div className="flex items-center gap-2 text-[var(--color-text-dim)]">
                          <span className="px-1.5 py-0.5 rounded bg-[var(--color-danger)]/10 text-[var(--color-danger)] text-[10px]">{pp.reason}</span>
                          {pp.restarts > 0 && <span>重启 {pp.restarts} 次</span>}
                          <span>{pp.age}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>
        )}

        {/* Row 4: 命名空间资源 */}
        {overview && kubeOk && (overview.namespaces?.length ?? 0) > 0 && (
          <Card title="命名空间资源">
            <div className="space-y-2.5">
              {overview.namespaces.slice(0, 10).map((ns, idx) => {
                const maxCpu = overview.namespaces[0].cpu_requests || 1
                const pct = Math.min((ns.cpu_requests / maxCpu) * 100, 100)
                // 排名越靠前颜色越深
                const barColor = idx < 2 ? 'var(--color-accent)' : idx < 5 ? 'var(--color-accent-soft, var(--color-accent))' : 'var(--color-surface-3, var(--color-border))'
                return (
                  <div key={ns.name} className="flex items-center gap-3 text-[12px]">
                    <span className="w-28 shrink-0 truncate text-[var(--color-text)] font-medium">{ns.name}</span>
                    <div className="flex-1 h-2 rounded-full bg-[var(--color-surface-2)] overflow-hidden">
                      <div className="h-full rounded-full transition-all" style={{ width: `${Math.max(pct, 2)}%`, backgroundColor: barColor, opacity: 0.8 }} />
                    </div>
                    <span className="w-20 text-right text-[var(--color-text-dim)] font-mono shrink-0">
                      {ns.cpu_requests.toFixed(2)} cores
                    </span>
                    <span className="w-20 text-right text-[var(--color-text-dim)] font-mono shrink-0">
                      {formatBytes(ns.mem_requests)}
                    </span>
                    <span className="w-14 text-right shrink-0">
                      <span className="inline-flex items-center gap-1 text-[11px] text-[var(--color-text-dim)]">
                        <span className="font-mono">{ns.pod_count}</span> pod
                      </span>
                    </span>
                  </div>
                )
              })}
            </div>
          </Card>
        )}

        {/* Row 5: Top 10 */}
        {overview && kubeOk && overview.metrics_available && ((overview.top_pods_cpu?.length ?? 0) > 0 || (overview.top_pods_memory?.length ?? 0) > 0) && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card title="CPU 消耗 Top 10">
              <TopList items={overview.top_pods_cpu} formatValue={(p) => `${p.cpu.toFixed(3)} cores`} getValue={(p) => p.cpu} />
            </Card>
            <Card title="内存消耗 Top 10">
              <TopList items={overview.top_pods_memory} formatValue={(p) => formatBytes(p.memory)} getValue={(p) => p.memory} />
            </Card>
          </div>
        )}

        {/* Row 6: 事件 + 调查 */}
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
                      <span className="text-[11px] font-medium text-[var(--color-warn)]">待处理</span>
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

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="text-[14px] font-semibold text-[var(--color-text)] mb-2">{children}</h2>
}

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

function pctColor(pct: number) {
  if (pct > 85) return '#ef4444'  // 红
  if (pct > 65) return '#f59e0b'  // 橙
  if (pct > 30) return '#10b981'  // 绿
  return '#06b6d4'                // 青
}

function MetricRow({ label, used, total, unit }: { label: string; used: number | null; total: number; unit: string }) {
  const pct = used != null && total > 0 ? Math.round((used / total) * 100) : null
  return (
    <div>
      <div className="flex items-center justify-between mb-1 text-[12px]">
        <span className="text-[var(--color-text-muted)]">{label}</span>
        <span className="text-[var(--color-text)] font-mono">
          {used != null ? `${used.toFixed(1)}` : '—'} / {total.toFixed(1)} {unit}
          {pct != null && (
            <span className="ml-1.5 font-semibold" style={{ color: pctColor(pct) }}>
              {pct}%
            </span>
          )}
        </span>
      </div>
      <div className="h-2 rounded-full bg-[var(--color-surface-2)] overflow-hidden">
        {pct != null && (
          <div
            className="h-full rounded-full transition-all"
            style={{ width: `${Math.min(pct, 100)}%`, backgroundColor: pctColor(pct) }}
          />
        )}
      </div>
    </div>
  )
}

function WorkloadRow({ label, counts }: { label: string; counts: WorkloadCounts }) {
  if (counts.total === 0) return null
  const pctReady = Math.round((counts.ready / counts.total) * 100)
  const pctDegraded = Math.round((counts.degraded / counts.total) * 100)
  return (
    <div>
      <div className="flex items-center justify-between mb-1 text-[12px]">
        <span className="text-[var(--color-text-muted)]">{label}</span>
        <span className="font-mono text-[var(--color-text)]">
          <span className="text-[var(--color-ok)]">{counts.ready}</span>
          {counts.degraded > 0 && <span className="text-[var(--color-warn)]"> / {counts.degraded}</span>}
          {counts.unavailable > 0 && <span className="text-[var(--color-danger)]"> / {counts.unavailable}</span>}
          <span className="text-[var(--color-text-dim)]"> / {counts.total}</span>
        </span>
      </div>
      <div className="h-2 rounded-full bg-[var(--color-surface-2)] overflow-hidden flex">
        <div className="h-full bg-[var(--color-ok)]" style={{ width: `${pctReady}%` }} />
        {counts.degraded > 0 && <div className="h-full bg-[var(--color-warn)]" style={{ width: `${pctDegraded}%` }} />}
      </div>
    </div>
  )
}

function TopList({ items, formatValue, getValue }: {
  items: { name: string; namespace: string; cpu: number; memory: number }[]
  formatValue: (item: { cpu: number; memory: number }) => string
  getValue: (item: { cpu: number; memory: number }) => number
}) {
  if (!items || items.length === 0) return <div className="text-[13px] text-[var(--color-text-dim)]">暂无数据</div>
  const maxVal = getValue(items[0]) || 1
  return (
    <div className="space-y-1.5">
      {items.map((p, i) => {
        const pct = Math.min((getValue(p) / maxVal) * 100, 100)
        const isTop3 = i < 3
        return (
          <div key={`${p.namespace}/${p.name}`} className="relative">
            {/* 背景条 */}
            <div
              className="absolute inset-y-0 left-0 rounded-r opacity-[0.07]"
              style={{ width: `${pct}%`, backgroundColor: isTop3 ? 'var(--color-accent)' : 'var(--color-text)' }}
            />
            <div className="relative flex items-center gap-2 text-[12px] py-1 px-1">
              <span className={`w-5 text-right shrink-0 font-mono ${isTop3 ? 'text-[var(--color-accent)] font-bold' : 'text-[var(--color-text-dim)]'}`}>
                {i + 1}
              </span>
              <span className="flex-1 truncate text-[var(--color-text)]">{p.name}</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--color-surface-2)] text-[var(--color-text-dim)] shrink-0">{p.namespace}</span>
              <span className={`w-24 text-right font-mono shrink-0 ${isTop3 ? 'text-[var(--color-text)] font-medium' : 'text-[var(--color-text-dim)]'}`}>
                {formatValue(p)}
              </span>
            </div>
          </div>
        )
      })}
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

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  const val = bytes / Math.pow(1024, i)
  return `${val.toFixed(val < 10 ? 2 : 1)} ${units[i]}`
}
