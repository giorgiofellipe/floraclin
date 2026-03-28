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
import { UpcomingFollowUps } from '@/components/dashboard/upcoming-follow-ups'
import { RecentActivity } from '@/components/dashboard/recent-activity'

function getGreeting(): string {
  const hour = new Date().getHours()
  if (hour < 12) return 'Bom dia'
  if (hour < 18) return 'Boa tarde'
  return 'Boa noite'
}

function getFormattedDate(): string {
  const now = new Date()
  return now.toLocaleDateString('pt-BR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })
}

export default async function DashboardPage() {
  const [context, data] = await Promise.all([
    getAuthContext(),
    getDashboardDataAction(),
  ])

  const firstName = context.fullName.split(' ')[0]
  const greeting = getGreeting()
  const formattedDate = getFormattedDate()

  return (
    <div className="space-y-8">
      {/* Greeting Area */}
      <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm uppercase tracking-wider text-mid">
            {formattedDate}
          </p>
          <h1 className="mt-2 text-4xl font-light text-forest" data-testid="dashboard-greeting">
            {greeting}, <span className="font-semibold">{firstName}</span>
          </h1>
          <p className="mt-1.5 text-mid">
            Bem-vindo ao seu painel FloraClin
          </p>
        </div>
        <div className="flex gap-3">
          <Link
            href="/pacientes?new=true"
            className="inline-flex items-center justify-center rounded-lg border border-forest/20 px-5 py-2.5 text-sm font-medium text-forest transition-all duration-200 hover:border-forest hover:bg-petal hover:shadow-sm"
          >
            <UserPlus className="mr-2 h-4 w-4" />
            Novo Paciente
          </Link>
          <Link
            href="/agenda?new=true"
            className="inline-flex items-center justify-center rounded-lg bg-forest px-5 py-2.5 text-sm font-medium text-cream shadow-sm transition-all duration-200 hover:bg-sage hover:shadow-md"
          >
            <CalendarPlus className="mr-2 h-4 w-4" />
            Novo Agendamento
          </Link>
        </div>
      </div>

      {/* Quick Stats */}
      <QuickStats stats={data.quickStats} showRevenue={context.role !== 'practitioner'} />

      {/* Appointments + Follow-ups */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <TodayAppointments appointments={data.todayAppointments} />
        </div>
        <div>
          <UpcomingFollowUps followUps={data.upcomingFollowUps} />
        </div>
      </div>

      {/* Recent Activity */}
      <RecentActivity activity={data.recentActivity} />
    </div>
  )
}
