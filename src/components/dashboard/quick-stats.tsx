import { Card, CardContent } from '@/components/ui/card'
import { Users, Stethoscope, DollarSign } from 'lucide-react'
import { formatCurrency } from '@/lib/utils'
import type { QuickStats as QuickStatsType } from '@/db/queries/dashboard'

interface QuickStatsProps {
  stats: QuickStatsType
  showRevenue?: boolean
}

const statCards = [
  {
    key: 'patientsThisWeek' as const,
    label: 'Pacientes esta semana',
    icon: Users,
    bg: 'bg-petal',
    format: (v: number | null) => String(v ?? 0),
    revenueOnly: false,
  },
  {
    key: 'proceduresThisMonth' as const,
    label: 'Procedimentos este mês',
    icon: Stethoscope,
    bg: 'bg-blush',
    format: (v: number | null) => String(v ?? 0),
    revenueOnly: false,
  },
  {
    key: 'revenueThisMonth' as const,
    label: 'Receita este mês',
    icon: DollarSign,
    bg: 'bg-petal',
    format: (v: number | null) => formatCurrency(v ?? 0),
    revenueOnly: true,
  },
]

export function QuickStats({ stats, showRevenue = true }: QuickStatsProps) {
  const visibleCards = showRevenue
    ? statCards
    : statCards.filter((card) => !card.revenueOnly)

  return (
    <div className={`grid grid-cols-1 gap-4 ${showRevenue ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`}>
      {visibleCards.map((card) => (
        <Card key={card.key} className={`${card.bg} border-0 shadow-sm`}>
          <CardContent className="flex items-center gap-4 p-6">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white/60">
              <card.icon className="h-6 w-6 text-forest" />
            </div>
            <div>
              <p className="text-sm uppercase tracking-wider text-mid">
                {card.label}
              </p>
              <p className="text-2xl font-semibold text-forest">
                {card.format(stats[card.key])}
              </p>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
