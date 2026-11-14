'use client'

import { useState } from 'react'
import { formatCurrency } from '@/lib/utils'

const TOP = 5

export interface RankingItem {
  name: string
  total: number
}

type RankingRow = RankingItem & { others?: true }

/** The TOP largest items, then the rest summed as "Outros" (a single leftover keeps its own name). */
function rankWithOthers(sorted: RankingItem[]): RankingRow[] {
  if (sorted.length <= TOP + 1) return sorted
  const rest = sorted.slice(TOP).reduce((sum, i) => sum + i.total, 0)
  return [...sorted.slice(0, TOP), { name: 'Outros', total: rest, others: true }]
}

export function RankingBars({ items, emptyLabel }: { items: RankingItem[]; emptyLabel: string }) {
  const [expanded, setExpanded] = useState(false)
  const sorted = items.filter((i) => i.total > 0).sort((a, b) => b.total - a.total)
  const grouped = rankWithOthers(sorted)
  const rows: RankingRow[] = expanded ? sorted : grouped
  const total = rows.reduce((sum, r) => sum + r.total, 0)

  if (rows.length === 0) {
    return <p className="py-6 text-center text-sm text-mid">{emptyLabel}</p>
  }

  const max = Math.max(...rows.map((r) => r.total))
  return (
    <div className="space-y-3">
      <ul className="space-y-3">
        {rows.map((row) => (
          <li key={row.others ? '__others' : row.name} className="space-y-1.5">
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="min-w-0 truncate text-charcoal" title={row.name}>
                {row.name}
              </span>
              <span className="shrink-0 tabular-nums text-charcoal">
                {formatCurrency(row.total)}
                <span className="ml-2 inline-block w-10 text-right text-xs text-mid">
                  {Math.round((row.total / total) * 100)}%
                </span>
              </span>
            </div>
            <div className="h-1.5 rounded-full bg-petal">
              <div
                className={row.others ? 'h-full rounded-full bg-mint' : 'h-full rounded-full bg-sage'}
                style={{ width: `${(row.total / max) * 100}%` }}
              />
            </div>
          </li>
        ))}
      </ul>
      {grouped.length < sorted.length && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="min-h-11 text-sm font-medium text-sage underline-offset-4 hover:text-forest hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sage md:min-h-0"
        >
          {expanded ? 'Mostrar menos' : `Mostrar todos (${sorted.length})`}
        </button>
      )}
    </div>
  )
}
