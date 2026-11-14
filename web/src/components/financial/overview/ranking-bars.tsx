import { formatCurrency } from '@/lib/utils'

const TOP = 5

export interface RankingItem {
  name: string
  total: number
}

/** The TOP largest items, then the rest summed as "Outros" (a single leftover keeps its own name). */
function rankWithOthers(items: RankingItem[]): Array<RankingItem & { others?: true }> {
  const sorted = items.filter((i) => i.total > 0).sort((a, b) => b.total - a.total)
  if (sorted.length <= TOP + 1) return sorted
  const rest = sorted.slice(TOP).reduce((sum, i) => sum + i.total, 0)
  return [...sorted.slice(0, TOP), { name: 'Outros', total: rest, others: true }]
}

export function RankingBars({ items, emptyLabel }: { items: RankingItem[]; emptyLabel: string }) {
  const rows = rankWithOthers(items)
  const total = rows.reduce((sum, r) => sum + r.total, 0)

  if (rows.length === 0) {
    return <p className="py-6 text-center text-sm text-mid">{emptyLabel}</p>
  }

  const max = Math.max(...rows.map((r) => r.total))
  return (
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
  )
}
