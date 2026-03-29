import type { QuickStats } from '@/db/queries/dashboard'

interface FinancialSummaryProps {
  stats: QuickStats
  monthlyGoal?: number
}

export function FinancialSummary({ stats, monthlyGoal = 0 }: FinancialSummaryProps) {
  const now = new Date()
  const monthName = now.toLocaleDateString('pt-BR', { month: 'long' })
  const capitalizedMonth = monthName.charAt(0).toUpperCase() + monthName.slice(1)
  const year = now.getFullYear()

  const received = stats.revenueThisMonth ?? 0
  const receivable = 0 // Placeholder — would come from real financial data
  const expenses = 0 // Placeholder — would come from real financial data
  const goal = monthlyGoal
  const progressPercent = goal > 0 ? Math.min(100, Math.round((received / goal) * 100)) : 0
  const netProfit = received - expenses

  return (
    <div
      className="bg-white shadow-[0_1px_4px_rgba(0,0,0,0.06)] rounded-[3px] p-5"
      data-testid="dashboard-financial"
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <span className="text-[14px] font-medium text-[#2A2A2A]">
          Financeiro — {capitalizedMonth}
        </span>
        <span className="text-[11px] font-medium uppercase tracking-wider text-[#7A7A7A] bg-[#F4F6F8] rounded-full px-2 py-0.5">
          {year}
        </span>
      </div>

      {/* Progress bar — only shown when a monthly goal is configured */}
      {goal > 0 && (
        <div className="mb-5">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[12px] text-[#7A7A7A]">
              Meta mensal R$ {goal.toLocaleString('pt-BR')}
            </span>
            <span className="text-[12px] text-[#7A7A7A]">
              {progressPercent}% atingido
            </span>
          </div>
          <div className="h-2 w-full rounded-full bg-[#F0F0F0] overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-[#8FB49A] to-[#4A6B52]"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>
      )}

      {/* Breakdown */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="h-3 w-3 rounded-sm bg-[#8FB49A]" />
            <span className="text-[13px] text-[#2A2A2A]">Recebido</span>
          </div>
          <span className="text-[13px] font-medium text-[#2A2A2A] tabular-nums">
            R$ {received.toLocaleString('pt-BR', { minimumFractionDigits: 0 })}
          </span>
        </div>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="h-3 w-3 rounded-sm bg-[#D4845A]" />
            <span className="text-[13px] text-[#2A2A2A]">A receber</span>
          </div>
          <span className="text-[13px] font-medium text-[#D4845A] tabular-nums">
            R$ {receivable.toLocaleString('pt-BR', { minimumFractionDigits: 0 })}
          </span>
        </div>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="h-3 w-3 rounded-sm bg-[#D0D0D0]" />
            <span className="text-[13px] text-[#2A2A2A]">Despesas</span>
          </div>
          <span className="text-[13px] font-medium text-[#2A2A2A] tabular-nums">
            R$ {expenses.toLocaleString('pt-BR', { minimumFractionDigits: 0 })}
          </span>
        </div>

        {/* Divider */}
        <div className="border-t border-[#F0F0F0] pt-3">
          <div className="flex items-center justify-between">
            <span className="text-[13px] text-[#7A7A7A]">Lucro liquido</span>
            <span className="text-[16px] font-semibold text-[#2A2A2A] tabular-nums">
              R$ {netProfit.toLocaleString('pt-BR', { minimumFractionDigits: 0 })}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
