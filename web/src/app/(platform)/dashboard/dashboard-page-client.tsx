'use client'

import { NEW_APPOINTMENT_PATH, NEW_PATIENT_PATH } from '@/lib/deep-links'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { UserPlus, CalendarPlus, X } from 'lucide-react'
import { useDashboard } from '@/hooks/queries/use-dashboard'
import { useTenant } from '@/hooks/queries/use-tenant'
import { brToday } from '@/lib/dates'
import { TodayAppointments } from '@/components/dashboard/today-appointments'
import { MoneyStrip } from '@/components/dashboard/money-strip'
import { RecentActivity } from '@/components/dashboard/recent-activity'
import { UpcomingBirthdaysCard } from '@/components/dashboard/upcoming-birthdays-card'
import { OpenPlanejamentosCard } from '@/components/dashboard/open-planejamentos-card'
import { TrialChecklistCard } from '@/components/dashboard/trial-checklist-card'
import { IMPORT_HELP_REQUESTED_SETTING } from '@/lib/import-help'
import { PendingRescheduleCard } from '@/components/dashboard/pending-reschedule-card'
import DashboardLoading from './loading'
import { ReadOnlyGuard } from '@/components/layout/subscription-access'
import { useHoldInstallBanner } from '@/components/layout/platform-chrome'

// While the first-patient hint is up, "Novo paciente" takes the primary style
// and "Novo agendamento" the outline one, so the eye goes where the hint says.
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
  /** Just finished onboarding: point at "Novo paciente" until the owner acts on it. */
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
  const settings = tenant?.settings as Record<string, unknown> | undefined

  if (isLoading || !data) {
    return <DashboardLoading />
  }

  const greeting = getGreeting()
  const todayCount = data.todayAppointments.length
  const bookingUrl =
    tenant?.slug && settings?.online_booking_enabled === true && typeof window !== 'undefined'
      ? `${window.location.origin}/c/${tenant.slug}`
      : null

  return (
    <div className="space-y-6">
      {/* Greeting Area */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1
            className="text-[24px] font-semibold text-charcoal"
            data-testid="dashboard-greeting"
          >
            {greeting}
          </h1>
          {todayCount > 0 && (
            <p className="mt-1 text-[13px] text-mid">
              {todayCount} agendamento{todayCount !== 1 ? 's' : ''} hoje
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex w-full gap-3 sm:w-auto">
            <ReadOnlyGuard label="Novo agendamento" className="flex-1 sm:flex-none">
              <Link
                href={NEW_APPOINTMENT_PATH}
                data-testid="dashboard-new-appointment"
                className={`inline-flex flex-1 items-center justify-center whitespace-nowrap rounded-lg px-4 py-2 text-[13px] font-medium transition-colors sm:flex-none ${
                  firstPatientHighlight ? OUTLINE_ACTION : PRIMARY_ACTION
                }`}
              >
                <CalendarPlus className="mr-1.5 h-4 w-4" />
                Novo agendamento
              </Link>
            </ReadOnlyGuard>
            <ReadOnlyGuard label="Novo paciente" className="flex-1 sm:flex-none">
              <Link
                href={NEW_PATIENT_PATH}
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
                Novo paciente
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
            em <span className="font-medium">Novo paciente</span>.
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
        latestPatientId={data.latestPatientId ?? null}
        canRequestImport={canRequestImport}
        importHelpRequested={!!settings?.[IMPORT_HELP_REQUESTED_SETTING]}
      />

      <PendingRescheduleCard count={data.pendingRescheduleCount ?? 0} />

      <div className="flex flex-col items-start gap-6 lg:flex-row">
        <div className="w-full min-w-0 flex-1">
          <TodayAppointments
            appointments={data.todayAppointments}
            firstAppointment={data.activation?.hasAppointment === false}
            bookingUrl={bookingUrl}
            monthAtendimentos={data.quickStats.revenueThisMonth === null ? data.quickStats.proceduresThisMonth : null}
          />
        </div>
        {/* Every card in this column hides itself when it has nothing to show; then "Hoje" takes the full width. */}
        <div className="w-full space-y-6 empty:hidden lg:w-[360px] lg:shrink-0">
          <MoneyStrip
            stats={data.quickStats}
            month={selectedMonth}
            currentMonth={currentMonth}
            onMonthChange={setSelectedMonth}
            monthlyGoal={(settings?.monthly_revenue_goal as number) || 0}
          />
          <UpcomingBirthdaysCard />
          <OpenPlanejamentosCard />
        </div>
      </div>

      <RecentActivity activity={data.recentActivity} />
    </div>
  )
}
