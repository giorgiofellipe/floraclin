import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Dashboard | FloraClin',
}
import { UserPlus, CalendarPlus } from 'lucide-react'
import { getAuthContext } from '@/lib/auth'
import { getDashboardDataAction } from '@/actions/dashboard'
import { QuickStats } from '@/components/dashboard/quick-stats'
import { TodayAppointments } from '@/components/dashboard/today-appointments'
import { FinancialSummary } from '@/components/dashboard/financial-summary'
import { RecentActivity } from '@/components/dashboard/recent-activity'

function getGreeting(): string {
  const hour = new Date().getHours()
  if (hour < 12) return 'Bom dia'
  if (hour < 18) return 'Boa tarde'
  return 'Boa noite'
}

export default async function DashboardPage() {
  const [context, data] = await Promise.all([
    getAuthContext(),
    getDashboardDataAction(),
  ])

  const firstName = context.fullName.split(' ')[0]
  const greeting = getGreeting()

  const todayCount = data.todayAppointments.length
  const monthCount = data.quickStats.proceduresThisMonth
  const revenue = data.quickStats.revenueThisMonth
  const showRevenue = context.role !== 'practitioner'

  // Overdue count placeholder — would come from financial data in production
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
            {greeting}, Dra. {firstName}
          </h1>
          <p className="mt-1 text-[13px] text-[#7A7A7A]">
            {subtitleParts.join(' · ')}
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
            className="inline-flex items-center justify-center rounded-[3px] border border-[#2A2A2A]/20 px-4 py-2 text-[13px] font-medium text-[#2A2A2A]"
          >
            <UserPlus className="mr-1.5 h-4 w-4" />
            Novo Paciente
          </Link>
          <Link
            href="/agenda?new=true"
            className="inline-flex items-center justify-center rounded-[3px] bg-[#4A6B52] px-4 py-2 text-[13px] font-medium text-white"
          >
            <CalendarPlus className="mr-1.5 h-4 w-4" />
            Novo Agendamento
          </Link>
        </div>
      </div>

      {/* KPI Cards */}
      <QuickStats stats={data.quickStats} showRevenue={showRevenue} todayCount={todayCount} />

      {/* Agenda + Financeiro */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <TodayAppointments appointments={data.todayAppointments} />
        {showRevenue && (
          <FinancialSummary stats={data.quickStats} />
        )}
      </div>

      {/* Recent Activity */}
      <RecentActivity activity={data.recentActivity} />
    </div>
  )
}
