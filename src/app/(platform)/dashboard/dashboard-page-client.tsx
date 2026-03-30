'use client'

import Link from 'next/link'
import { UserPlus, CalendarPlus } from 'lucide-react'
import { useDashboard } from '@/hooks/queries/use-dashboard'
import { useTenant } from '@/hooks/queries/use-settings'
import { QuickStats } from '@/components/dashboard/quick-stats'
import { TodayAppointments } from '@/components/dashboard/today-appointments'
import { FinancialSummary } from '@/components/dashboard/financial-summary'
import { RecentActivity } from '@/components/dashboard/recent-activity'
import DashboardLoading from './loading'

function getGreeting(): string {
  const hour = new Date().getHours()
  if (hour < 12) return 'Bom dia'
  if (hour < 18) return 'Boa tarde'
  return 'Boa noite'
}

export function DashboardPageClient() {
  const { data, isLoading } = useDashboard()
  const { data: tenant } = useTenant()

  if (isLoading || !data) {
    return <DashboardLoading />
  }

  const greeting = getGreeting()
  const todayCount = data.todayAppointments.length
  const overdueCount: number = 0

  const subtitleParts: string[] = []
  subtitleParts.push(`${todayCount} atendimento${todayCount !== 1 ? 's' : ''} hoje`)
  if (overdueCount > 0) {
    subtitleParts.push(`${overdueCount} pagamento${overdueCount !== 1 ? 's' : ''} pendente${overdueCount !== 1 ? 's' : ''}`)
  }

  return (
    <div className="space-y-6">
      {/* Greeting Area */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1
            className="text-[24px] font-medium text-[#2A2A2A]"
            data-testid="dashboard-greeting"
          >
            {greeting}
          </h1>
          <p className="mt-1 text-[13px] text-[#7A7A7A]">
            {subtitleParts.join(' \u00b7 ')}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {overdueCount > 0 && (
            <div className="inline-flex items-center gap-1.5 rounded-full border border-[#F5D5C4] bg-[#FFF4EF] px-3 py-1">
              <span className="h-2 w-2 rounded-full bg-[#D4845A]" />
              <span className="text-[12px] text-[#D4845A]">
                {overdueCount} pagamento{overdueCount !== 1 ? 's' : ''} vencido{overdueCount !== 1 ? 's' : ''}
              </span>
            </div>
          )}
          <Link
            href="/pacientes?new=true"
            className="inline-flex items-center justify-center rounded-lg border border-sage/30 px-4 py-2 text-[13px] font-medium text-charcoal hover:bg-[#F0F7F1] transition-colors"
          >
            <UserPlus className="mr-1.5 h-4 w-4" />
            Novo Paciente
          </Link>
          <Link
            href="/agenda?new=true"
            className="inline-flex items-center justify-center rounded-lg bg-forest px-4 py-2 text-[13px] font-medium text-cream hover:bg-sage transition-colors"
          >
            <CalendarPlus className="mr-1.5 h-4 w-4" />
            Novo Agendamento
          </Link>
        </div>
      </div>

      {/* KPI Cards */}
      <QuickStats stats={data.quickStats} showRevenue={true} todayCount={todayCount} />

      {/* Agenda + Financeiro */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <TodayAppointments appointments={data.todayAppointments} />
        <FinancialSummary
          stats={data.quickStats}
          monthlyGoal={((tenant?.settings as Record<string, unknown>)?.monthly_revenue_goal as number) || 0}
        />
      </div>

      {/* Recent Activity */}
      <RecentActivity activity={data.recentActivity} />
    </div>
  )
}
