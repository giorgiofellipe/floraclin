import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Dashboard | FloraClin',
}
import { buttonVariants } from '@/components/ui/button'
import { UserPlus, CalendarPlus } from 'lucide-react'
import { cn } from '@/lib/utils'
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

export default async function DashboardPage() {
  const [context, data] = await Promise.all([
    getAuthContext(),
    getDashboardDataAction(),
  ])

  const firstName = context.fullName.split(' ')[0]
  const greeting = getGreeting()

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-3xl font-semibold text-forest">
            {greeting}, {firstName}
          </h1>
          <p className="mt-1 text-mid">Bem-vindo ao FloraClin</p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/pacientes?new=true"
            className={cn(
              buttonVariants({ variant: 'outline' }),
              'border-forest text-forest hover:bg-petal'
            )}
          >
            <UserPlus className="mr-2 h-4 w-4" />
            Novo Paciente
          </Link>
          <Link
            href="/agenda?new=true"
            className={cn(
              buttonVariants(),
              'bg-forest text-cream hover:bg-sage'
            )}
          >
            <CalendarPlus className="mr-2 h-4 w-4" />
            Novo Agendamento
          </Link>
        </div>
      </div>

      {/* Quick Stats */}
      <QuickStats stats={data.quickStats} />

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
