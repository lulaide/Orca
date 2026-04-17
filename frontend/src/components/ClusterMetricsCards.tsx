import { useEffect, useState } from 'react'
import { getClusterMetrics, type ClusterMetrics } from '../api'

/**
 * 仿 Lens Dashboard 的 CPU / Memory / Pods 三卡。
 * usage 段用 accent 色,requests 段在 usage 之外叠一层 muted 绿,
 * 最外圈是 capacity-allocatable 的差值(以 dim 色体现被系统预留的部分)。
 */
export function ClusterMetricsCards() {
  const [m, setM] = useState<ClusterMetrics | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setInterval> | null = null
    const load = () => {
      getClusterMetrics()
        .then((data) => {
          if (!cancelled) {
            setM(data)
            setErr(null)
          }
        })
        .catch((e) => {
          if (!cancelled) setErr(e instanceof Error ? e.message : '加载失败')
        })
    }
    load()
    timer = setInterval(load, 30000)
    return () => {
      cancelled = true
      if (timer) clearInterval(timer)
    }
  }, [])

  if (err) {
    return (
      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 text-[11.5px] font-mono text-[var(--color-danger)]">
        集群指标加载失败：{err}
      </div>
    )
  }

  if (!m) {
    return (
      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-6 text-[12px] font-mono text-[var(--color-text-dim)] text-center">
        加载集群指标中…
      </div>
    )
  }

  return (
    <section>
      <div className="flex items-center justify-between mb-2">
        <div className="text-[11px] uppercase tracking-[0.22em] text-[var(--color-text-dim)] font-mono">
          cluster · 资源
        </div>
        <div className="text-[11px] font-mono text-[var(--color-text-dim)]">
          nodes {m.nodes.ready}/{m.nodes.total}
          {!m.metrics_available && (
            <span className="ml-2 text-[var(--color-warn)]">· metrics-server 未就绪</span>
          )}
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <MetricCard
          title="CPU"
          unit="core"
          usage={m.cpu.usage}
          requests={m.cpu.requests}
          limits={m.cpu.limits}
          allocatable={m.cpu.allocatable}
          capacity={m.cpu.capacity}
          format={formatCores}
        />
        <MetricCard
          title="Memory"
          unit="B"
          usage={m.memory.usage}
          requests={m.memory.requests}
          limits={m.memory.limits}
          allocatable={m.memory.allocatable}
          capacity={m.memory.capacity}
          format={formatBytes}
        />
        <MetricCard
          title="Pods"
          unit=""
          usage={m.pods.usage}
          allocatable={m.pods.allocatable}
          capacity={m.pods.capacity}
          format={(v) => String(Math.round(v))}
        />
      </div>
    </section>
  )
}

// ---- Card ----

interface MetricCardProps {
  title: string
  unit: string
  usage: number | null | undefined
  requests?: number
  limits?: number
  allocatable: number
  capacity: number
  format: (v: number) => string
}

function MetricCard({
  title,
  unit,
  usage,
  requests,
  limits,
  allocatable,
  capacity,
  format,
}: MetricCardProps) {
  // 圆环分母取 allocatable(或 capacity 兜底)
  const denom = allocatable > 0 ? allocatable : capacity
  const usageRatio = usage != null && denom > 0 ? clamp01(usage / denom) : 0
  const reqRatio = requests != null && denom > 0 ? clamp01(requests / denom) : 0
  const limRatio = limits != null && denom > 0 ? clamp01(limits / denom) : 0

  const hasUsage = usage != null

  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 flex flex-col">
      <div className="text-center text-[13px] text-[var(--color-text-muted)] mb-2">{title}</div>
      <div className="flex justify-center">
        <Donut
          usage={usageRatio}
          requests={reqRatio}
          limits={limRatio}
          showUsage={hasUsage}
        />
      </div>
      <ul className="mt-3 space-y-1 font-mono text-[11.5px]">
        {hasUsage && (
          <Legend color="var(--color-accent)" label="Usage" value={`${format(usage!)}${unit ? ' ' + unit : ''}`} />
        )}
        {requests != null && (
          <Legend color="var(--color-ok)" label="Requests" value={`${format(requests)}${unit ? ' ' + unit : ''}`} />
        )}
        {limits != null && (
          <Legend color="var(--color-info, #5b8def)" label="Limits" value={`${format(limits)}${unit ? ' ' + unit : ''}`} />
        )}
        <Legend
          color="var(--color-text-dim)"
          label="Allocatable"
          value={`${format(allocatable)}${unit ? ' ' + unit : ''}`}
          dim
        />
        <Legend
          color="var(--color-border-strong)"
          label="Capacity"
          value={`${format(capacity)}${unit ? ' ' + unit : ''}`}
          dim
        />
      </ul>
    </div>
  )
}

function Legend({
  color,
  label,
  value,
  dim,
}: {
  color: string
  label: string
  value: string
  dim?: boolean
}) {
  return (
    <li className="flex items-center gap-2">
      <span className="w-2 h-2 shrink-0" style={{ backgroundColor: color }} />
      <span className={`w-[72px] shrink-0 ${dim ? 'text-[var(--color-text-dim)]' : 'text-[var(--color-text-muted)]'}`}>
        {label}:
      </span>
      <span className={`truncate tabular-nums ${dim ? 'text-[var(--color-text-dim)]' : 'text-[var(--color-text)]'}`}>
        {value}
      </span>
    </li>
  )
}

// ---- Donut (纯 SVG,叠层弧) ----

interface DonutProps {
  usage: number   // 0..1
  requests: number
  limits: number
  showUsage: boolean
}

const SIZE = 120
const STROKE = 8
const R = (SIZE - STROKE) / 2
const CIRC = 2 * Math.PI * R

function arcDash(ratio: number): string {
  const len = CIRC * ratio
  return `${len} ${CIRC - len}`
}

function Donut({ usage, requests, limits, showUsage }: DonutProps) {
  // 三条同心弧,从低到高叠:allocatable 底环 → limits → requests → usage
  // 使用 rotate(-90) 让起点在 12 点钟
  return (
    <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
      <g transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}>
        {/* 底环:allocatable */}
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={R}
          fill="none"
          stroke="var(--color-surface-3, var(--color-border))"
          strokeWidth={STROKE}
        />
        {/* limits */}
        {limits > 0 && (
          <circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={R}
            fill="none"
            stroke="var(--color-info, #5b8def)"
            strokeWidth={STROKE}
            strokeDasharray={arcDash(limits)}
            strokeLinecap="butt"
            opacity={0.55}
          />
        )}
        {/* requests */}
        {requests > 0 && (
          <circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={R}
            fill="none"
            stroke="var(--color-ok)"
            strokeWidth={STROKE}
            strokeDasharray={arcDash(requests)}
            strokeLinecap="butt"
            opacity={0.85}
          />
        )}
        {/* usage */}
        {showUsage && usage > 0 && (
          <circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={R}
            fill="none"
            stroke="var(--color-accent)"
            strokeWidth={STROKE}
            strokeDasharray={arcDash(usage)}
            strokeLinecap="round"
          />
        )}
      </g>
      {/* 中心百分比 */}
      <text
        x="50%"
        y="50%"
        dominantBaseline="central"
        textAnchor="middle"
        className="font-mono"
        style={{
          fill: 'var(--color-text-muted)',
          fontSize: 13,
        }}
      >
        {showUsage ? `${Math.round(usage * 100)}%` : '—'}
      </text>
    </svg>
  )
}

// ---- helpers ----

function clamp01(v: number): number {
  if (!Number.isFinite(v) || v < 0) return 0
  if (v > 1) return 1
  return v
}

function formatCores(v: number): string {
  if (v >= 1) return v.toFixed(2)
  return v.toFixed(3)
}

function formatBytes(v: number): string {
  if (v < 1024) return `${v}`
  const units = ['KiB', 'MiB', 'GiB', 'TiB']
  let n = v / 1024
  let i = 0
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024
    i++
  }
  return `${n.toFixed(n >= 100 ? 0 : n >= 10 ? 1 : 2)} ${units[i]}`
}
