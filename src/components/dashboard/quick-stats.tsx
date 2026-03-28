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
    gradient: 'bg-gradient-to-br from-cream to-petal',
    iconBg: 'bg-sage/10',
    iconColor: 'text-sage',
    format: (v: number | null) => String(v ?? 0),
    revenueOnly: false,
  },
  {
    key: 'proceduresThisMonth' as const,
    label: 'Procedimentos este mes',
    icon: Stethoscope,
    gradient: 'bg-gradient-to-br from-petal to-blush',
    iconBg: 'bg-mint/15',
    iconColor: 'text-mint',
    format: (v: number | null) => String(v ?? 0),
    revenueOnly: false,
  },
  {
    key: 'revenueThisMonth' as const,
    label: 'Receita este mes',
    icon: DollarSign,
    gradient: 'bg-gradient-to-br from-cream to-petal',
    iconBg: 'bg-sage/10',
    iconColor: 'text-sage',
    format: (v: number | null) => formatCurrency(v ?? 0),
    revenueOnly: true,
  },
]

export function QuickStats({ stats, showRevenue = true }: QuickStatsProps) {
  const visibleCards = showRevenue
    ? statCards
    : statCards.filter((card) => !card.revenueOnly)

  return (
    <div className={`grid grid-cols-1 gap-5 ${showRevenue ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`} data-testid="dashboard-stats">
      {visibleCards.map((card) => (
        <div
          key={card.key}
          className={`group relative overflow-hidden rounded-xl ${card.gradient} border border-white/60 p-6 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md`}
        >
          {/* Gold accent border at bottom */}
          <div className="absolute inset-x-0 bottom-0 h-[2px] bg-gradient-to-r from-gold/40 via-gold/60 to-gold/40" />

          <div className="flex items-start justify-between">
            <div className="space-y-2">
              <p className="text-xs uppercase tracking-wider text-mid font-medium">
                {card.label}
              </p>
              <p className="text-3xl font-bold text-forest tracking-tight">
                {card.format(stats[card.key])}
              </p>
            </div>
            <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${card.iconBg}`}>
              <card.icon className={`h-5 w-5 ${card.iconColor}`} />
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
