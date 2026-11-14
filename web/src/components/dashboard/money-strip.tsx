import Link from 'next/link'
import { formatCurrency } from '@/lib/utils'
import { MonthSelector } from '@/components/dashboard/month-selector'
import type { QuickStats } from '@/db/queries/dashboard'

interface MoneyStripProps {
  stats: QuickStats
  month: string
  currentMonth: string
  onMonthChange: (month: string) => void
  monthlyGoal?: number
}

/** The month's money in one card. Practitioners get null figures and no card. */
export function MoneyStrip({ stats, month, currentMonth, onMonthChange, monthlyGoal = 0 }: MoneyStripProps) {
  if (stats.revenueThisMonth === null) return null

  const received = stats.revenueThisMonth
  const overdue = stats.totalOverdue ?? 0
  const expenses = stats.totalExpenses ?? 0
  const cardFees = stats.totalCardFees ?? 0
  // The header and month selector stay: they are the only way to reach other months.
  const nothingMoved = [received, stats.totalPending, expenses, overdue].every((v) => !v)

  return (
    <section
      aria-labelledby="money-title"
      className="rounded-lg bg-white p-5 shadow-[0_1px_4px_rgba(0,0,0,0.06)]"
      data-testid="dashboard-money"
    >
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 id="money-title" className="text-[15px] font-semibold text-charcoal">Financeiro</h2>
        <MonthSelector month={month} currentMonth={currentMonth} onChange={onMonthChange} />
      </div>
      {nothingMoved ? (
        <p className="text-[13px] text-mid">Nenhum valor neste mês.</p>
      ) : (
        <Figures received={received} pending={stats.totalPending ?? 0} overdue={overdue} expenses={expenses} cardFees={cardFees} goal={monthlyGoal} />
      )}
    </section>
  )
}

function Figures({ received, pending, overdue, expenses, cardFees, goal }: { received: number; pending: number; overdue: number; expenses: number; cardFees: number; goal: number }) {
  const net = received - expenses - cardFees
  const goalPercent = goal > 0 ? Math.min(100, Math.round((received / goal) * 100)) : null
  const figures = [
    { label: 'Recebido', value: received, tone: 'text-forest' },
    { label: 'A receber', value: pending, tone: 'text-charcoal' },
    { label: 'Vencido', value: overdue, tone: overdue > 0 ? 'text-amber-dark' : 'text-charcoal' },
    { label: 'Lucro líquido', value: net, tone: net < 0 ? 'text-amber-dark' : 'text-charcoal' },
  ]
  const details = [`Despesas ${formatCurrency(expenses)}`, `Taxas ${formatCurrency(cardFees)}`, goal > 0 ? `Meta ${formatCurrency(goal)}` : null]

  return (
    <>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
        {figures.map((f) => (
          <div key={f.label} className="min-w-0">
            <dt className="text-[12px] text-mid">{f.label}</dt>
            <dd className={`truncate text-lg font-semibold tabular-nums ${f.tone}`}>{formatCurrency(f.value)}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-2 text-[12px] text-mid">{details.filter(Boolean).join(' · ')}</p>
      {goalPercent !== null && (
        <div className="mt-3">
          <div className="flex justify-between text-[12px] text-mid">
            <span>Meta do mês</span>
            <span className="tabular-nums">{goalPercent}%</span>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-content-bg" role="progressbar" aria-valuenow={goalPercent} aria-valuemin={0} aria-valuemax={100} aria-label="Meta do mês">
            <div className="h-full rounded-full bg-sage" style={{ width: `${goalPercent}%` }} />
          </div>
        </div>
      )}
      <Link
        href={overdue > 0 ? '/financeiro?tab=receivables&isOverdue=true' : '/financeiro'}
        className="mt-4 inline-block text-[13px] font-medium text-forest hover:underline"
      >
        {overdue > 0 ? 'Ver cobranças vencidas' : 'Abrir Financeiro'}
      </Link>
    </>
  )
}
