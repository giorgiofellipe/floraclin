'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { UserPlus, CalendarPlus, X } from 'lucide-react'
import { useDashboard } from '@/hooks/queries/use-dashboard'
import { useTenant } from '@/hooks/queries/use-tenant'
import { brToday } from '@/lib/dates'
import { QuickStats } from '@/components/dashboard/quick-stats'
import { TodayAppointments } from '@/components/dashboard/today-appointments'
import { FinancialSummary } from '@/components/dashboard/financial-summary'
import { RecentActivity } from '@/components/dashboard/recent-activity'
import { UpcomingBirthdaysCard } from '@/components/dashboard/upcoming-birthdays-card'
import { OpenPlanejamentosCard } from '@/components/dashboard/open-planejamentos-card'
import { TrialChecklistCard } from '@/components/dashboard/trial-checklist-card'
import { IMPORT_HELP_REQUESTED_SETTING } from '@/lib/import-help'
import { PendingRescheduleCard } from '@/components/dashboard/pending-reschedule-card'
import { MonthSelector } from '@/components/dashboard/month-selector'
import DashboardLoading from './loading'
import { ReadOnlyGuard } from '@/components/layout/subscription-access'
import { useHoldInstallBanner } from '@/components/layout/platform-chrome'

// While the first-patient hint is up, "Novo Paciente" takes the primary style
// and "Novo Agendamento" the outline one, so the eye goes where the hint says.
// Both carry a 1px border so the buttons keep the same height when they swap.
const PRIMARY_ACTION = 'border border-transparent bg-forest text-cream hover:bg-sage'
const OUTLINE_ACTION = 'border border-sage/30 text-charcoal hover:bg-confirmed-bg'

function getGreeting(): string {
  const hour = new Date().getHours()
  if (hour < 12) return 'Bom dia'
  if (hour < 18) return 'Boa tarde'
  return 'Boa noite'
}

interface DashboardPageClientProps {
  /** Just finished onboarding: point at "Novo Paciente" until the owner acts on it. */
  highlightFirstPatient?: boolean
  canRequestImport?: boolean
}

export function DashboardPageClient({ highlightFirstPatient = false, canRequestImport = false }: DashboardPageClientProps) {
  const router = useRouter()
  // Read once from the URL, which is cleaned straight away: a reload or Back
  // to this page does not highlight again. Leaving the page drops it too.
  const [firstPatientHighlight, setFirstPatientHighlight] = useState(highlightFirstPatient)
  useEffect(() => {
    if (highlightFirstPatient) router.replace('/dashboard', { scroll: false })
  }, [highlightFirstPatient, router])
  // The install banner would cover the guidance on phones; it waits.
  useHoldInstallBanner(firstPatientHighlight)
  const currentMonth = brToday().slice(0, 7)
  const [selectedMonth, setSelectedMonth] = useState(currentMonth)
  // Omit the month param entirely when it's the current month, so the
  // request stays identical to the pre-navigation default.
  const { data, isLoading } = useDashboard(
    selectedMonth === currentMonth ? undefined : selectedMonth
  )
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
        <div className="flex flex-wrap items-center gap-3">
          <MonthSelector
            month={selectedMonth}
            currentMonth={currentMonth}
            onChange={setSelectedMonth}
          />
          {overdueCount > 0 && (
            <div className="inline-flex items-center gap-1.5 rounded-full border border-[#F5D5C4] bg-[#FFF4EF] px-3 py-1">
              <span className="h-2 w-2 rounded-full bg-[#D4845A]" />
              <span className="text-[12px] text-[#D4845A]">
                {overdueCount} pagamento{overdueCount !== 1 ? 's' : ''} vencido{overdueCount !== 1 ? 's' : ''}
              </span>
            </div>
          )}
          <div className="flex w-full gap-3 sm:w-auto">
            <ReadOnlyGuard label="Novo Paciente" className="flex-1 sm:flex-none">
              <Link
                href="/pacientes?new=true"
                onClick={() => setFirstPatientHighlight(false)}
                aria-describedby={firstPatientHighlight ? 'first-patient-hint' : undefined}
                data-highlighted={firstPatientHighlight || undefined}
                data-testid="dashboard-new-patient"
                className={`inline-flex flex-1 items-center justify-center whitespace-nowrap rounded-lg px-4 py-2 text-[13px] font-medium transition-colors sm:flex-none ${
                  firstPatientHighlight
                    ? `${PRIMARY_ACTION} outline-2 outline-offset-2 outline-forest motion-safe:animate-subtle-pulse`
                    : OUTLINE_ACTION
                }`}
              >
                <UserPlus className="mr-1.5 h-4 w-4" />
                Novo Paciente
              </Link>
            </ReadOnlyGuard>
            <ReadOnlyGuard label="Novo Agendamento" className="flex-1 sm:flex-none">
              <Link
                href="/agenda?new=true"
                data-testid="dashboard-new-appointment"
                className={`inline-flex flex-1 items-center justify-center whitespace-nowrap rounded-lg px-4 py-2 text-[13px] font-medium transition-colors sm:flex-none ${
                  firstPatientHighlight ? OUTLINE_ACTION : PRIMARY_ACTION
                }`}
              >
                <CalendarPlus className="mr-1.5 h-4 w-4" />
                Novo Agendamento
              </Link>
            </ReadOnlyGuard>
          </div>
        </div>
      </div>

      {firstPatientHighlight && (
        <div
          role="status"
          className="flex items-start justify-between gap-3 rounded-lg border border-forest/40 bg-confirmed-bg px-4 py-3"
          data-testid="first-patient-hint"
        >
          <p id="first-patient-hint" className="text-sm text-charcoal">
            <strong className="font-medium">Sua clínica está pronta.</strong> Comece cadastrando seu primeiro paciente
            em <span className="font-medium">Novo Paciente</span>.
          </p>
          <button
            type="button"
            onClick={() => setFirstPatientHighlight(false)}
            // 44px tap target; the negative margin keeps the card as compact as before.
            className="-my-2.5 -mr-2.5 inline-flex size-11 shrink-0 items-center justify-center rounded text-mid hover:text-charcoal"
            aria-label="Dispensar dica"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      <TrialChecklistCard
        activation={data.activation}
        canRequestImport={canRequestImport}
        importHelpRequested={!!(tenant?.settings as Record<string, unknown> | undefined)?.[IMPORT_HELP_REQUESTED_SETTING]}
      />

      {/* Pending Reschedule Alert */}
      <PendingRescheduleCard count={data.pendingRescheduleCount ?? 0} />

      {/* KPI Cards */}
      <QuickStats stats={data.quickStats} showRevenue={true} todayCount={todayCount} />

      {/* Agenda + Financeiro */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <TodayAppointments appointments={data.todayAppointments} />
        <FinancialSummary
          stats={data.quickStats}
          month={selectedMonth}
          monthlyGoal={((tenant?.settings as Record<string, unknown>)?.monthly_revenue_goal as number) || 0}
        />
      </div>

      {/* Aniversariantes + Planejamentos Abertos */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <UpcomingBirthdaysCard />
        <OpenPlanejamentosCard />
      </div>

      {/* Recent Activity */}
      <RecentActivity activity={data.recentActivity} />
    </div>
  )
}
