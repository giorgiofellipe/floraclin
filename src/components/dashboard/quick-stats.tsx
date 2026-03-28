import { formatCurrency } from '@/lib/utils'
import type { QuickStats as QuickStatsType } from '@/db/queries/dashboard'

interface QuickStatsProps {
  stats: QuickStatsType
  showRevenue?: boolean
  todayCount: number
}

export function QuickStats({ stats, showRevenue = true, todayCount }: QuickStatsProps) {
  const cards = [
    {
      key: 'today',
      eyebrow: 'HOJE',
      value: String(todayCount),
      sublabel: `atendimento${todayCount !== 1 ? 's' : ''}`,
      accentBorder: false,
      valueColor: 'text-[#2A2A2A]',
      sublabelColor: 'text-[#7A7A7A]',
    },
    {
      key: 'month',
      eyebrow: 'ESTE MES',
      value: String(stats.proceduresThisMonth),
      sublabel: 'atendimentos',
      accentBorder: false,
      valueColor: 'text-[#2A2A2A]',
      sublabelColor: 'text-[#7A7A7A]',
    },
  ]

  if (showRevenue && stats.revenueThisMonth !== null) {
    const revenueFormatted = stats.revenueThisMonth >= 1000
      ? `R$ ${(stats.revenueThisMonth / 1000).toFixed(1).replace('.', ',')}k`
      : formatCurrency(stats.revenueThisMonth)

    cards.push({
      key: 'received',
      eyebrow: 'RECEBIDO',
      value: revenueFormatted,
      sublabel: 'este mes',
      accentBorder: false,
      valueColor: 'text-[#4A6B52]',
      sublabelColor: 'text-[#7A7A7A]',
    })

    cards.push({
      key: 'receivable',
      eyebrow: 'A RECEBER',
      value: 'R$ 0',
      sublabel: '',
      accentBorder: true,
      valueColor: 'text-[#D4845A]',
      sublabelColor: 'text-[#D4845A]',
    })
  }

  return (
    <div
      className={`grid grid-cols-1 gap-4 sm:grid-cols-2 ${cards.length === 4 ? 'lg:grid-cols-4' : cards.length === 3 ? 'lg:grid-cols-3' : 'lg:grid-cols-2'}`}
      data-testid="dashboard-stats"
    >
      {cards.map((card) => (
        <div
          key={card.key}
          className={`bg-white shadow-[0_1px_4px_rgba(0,0,0,0.06)] rounded-[3px] p-5 ${card.accentBorder ? 'border-t-2 border-[#D4845A]' : ''}`}
        >
          <p className="text-[11px] font-medium uppercase tracking-wider text-[#7A7A7A]">
            {card.eyebrow}
          </p>
          <p className={`mt-1 text-[28px] font-semibold leading-tight ${card.valueColor}`}>
            {card.value}
          </p>
          {card.sublabel && (
            <p className={`mt-0.5 text-[13px] ${card.sublabelColor}`}>
              {card.sublabel}
            </p>
          )}
        </div>
      ))}
    </div>
  )
}
