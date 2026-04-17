import { useEffect, useMemo, useRef, useState } from 'react'
import { listInvestigations, type Investigation } from '../api'
import { SeverityDot, StatusBadge } from './investigationUI'

interface Props {
  open: boolean
  // 当以 @ 触发时，anchor = caret 屏幕坐标；undefined = 作为 composer 上方居中 dropdown
  anchor?: { x: number; y: number }
  searchQuery: string
  onSearchQueryChange: (q: string) => void
  // 已选中的 id，从候选中过滤掉
  excludeIds?: string[]
  onPick: (inv: Investigation) => void
  onClose: () => void
}

// 拉取 + 缓存活跃 investigation 列表，本地按 title.includes 过滤。
export function InvestigationPicker({
  open,
  anchor,
  searchQuery,
  onSearchQueryChange,
  excludeIds,
  onPick,
  onClose,
}: Props) {
  const [items, setItems] = useState<Investigation[]>([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [highlight, setHighlight] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  // 打开时拉一次，关闭时 reset highlight
  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    setErr(null)
    listInvestigations({ view: 'active' })
      .then((list) => {
        if (cancelled) return
        setItems(list)
        setLoading(false)
      })
      .catch((e: unknown) => {
        if (cancelled) return
        setErr(e instanceof Error ? e.message : String(e))
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open])

  // 打开时聚焦搜索框；anchor 模式下不抢焦点（从 textarea 过来的 @ 不打断输入）
  useEffect(() => {
    if (open && !anchor) inputRef.current?.focus()
    if (!open) setHighlight(0)
  }, [open, anchor])

  // 点击外部关闭
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current) return
      if (!rootRef.current.contains(e.target as Node)) onClose()
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [open, onClose])

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    const ex = new Set(excludeIds ?? [])
    return items
      .filter((i) => !ex.has(i.id))
      .filter((i) => (q ? i.title.toLowerCase().includes(q) : true))
      .slice(0, 50)
  }, [items, searchQuery, excludeIds])

  // filtered 变化时把 highlight 钳到有效范围
  useEffect(() => {
    if (highlight >= filtered.length) setHighlight(Math.max(0, filtered.length - 1))
  }, [filtered.length, highlight])

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlight((h) => (filtered.length === 0 ? 0 : (h + 1) % filtered.length))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlight((h) => (filtered.length === 0 ? 0 : (h - 1 + filtered.length) % filtered.length))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const pick = filtered[highlight]
      if (pick) onPick(pick)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    }
  }

  if (!open) return null

  // anchor 模式下用 fixed 定位；否则作为父容器的 absolute dropdown（父容器需 relative）
  const style: React.CSSProperties = anchor
    ? { position: 'fixed', left: anchor.x, top: anchor.y, zIndex: 60 }
    : { position: 'absolute', left: 0, right: 0, bottom: 'calc(100% + 6px)', zIndex: 30 }

  return (
    <div
      ref={rootRef}
      style={style}
      onKeyDown={handleKey}
      className="rounded-md border border-[var(--color-border-strong)] bg-[var(--color-surface)]
        shadow-xl w-[min(420px,90vw)] max-h-[320px] overflow-hidden flex flex-col"
    >
      {!anchor && (
        <div className="border-b border-[var(--color-border)] px-2 py-1.5">
          <input
            ref={inputRef}
            value={searchQuery}
            onChange={(e) => onSearchQueryChange(e.target.value)}
            placeholder="搜索调查…"
            className="w-full bg-transparent text-[13px] outline-none text-[var(--color-text)] placeholder:text-[var(--color-text-dim)]"
          />
        </div>
      )}
      <div className="flex-1 overflow-y-auto">
        {loading && (
          <div className="px-3 py-3 text-[12px] text-[var(--color-text-dim)]">加载中…</div>
        )}
        {err && (
          <div className="px-3 py-3 text-[12px] text-[var(--color-danger)]">加载失败：{err}</div>
        )}
        {!loading && !err && filtered.length === 0 && (
          <div className="px-3 py-3 text-[12px] text-[var(--color-text-dim)]">
            {items.length === 0 ? '暂无活跃调查' : '没有匹配结果'}
          </div>
        )}
        {filtered.map((inv, idx) => (
          <button
            key={inv.id}
            type="button"
            onMouseEnter={() => setHighlight(idx)}
            onClick={() => onPick(inv)}
            className={`w-full text-left px-3 py-2 flex items-center gap-2 border-b border-[var(--color-border)]/50 last:border-b-0
              ${idx === highlight ? 'bg-[var(--color-accent-soft)]' : 'hover:bg-[var(--color-surface-2)]'}`}
          >
            <SeverityDot severity={inv.severity} />
            <span className="flex-1 truncate text-[13px] text-[var(--color-text)]">
              {inv.title || '未命名调查'}
            </span>
            <StatusBadge status={inv.status} />
            <span className="font-mono text-[10.5px] text-[var(--color-text-dim)] shrink-0">
              {inv.id.slice(0, 6)}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
