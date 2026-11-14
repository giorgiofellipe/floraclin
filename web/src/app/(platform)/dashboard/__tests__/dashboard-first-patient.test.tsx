/**
 * After onboarding the dashboard points at "Novo Paciente" once: from the
 * `primeiro_paciente=1` the wizard adds, dropped from the URL straight away,
 * and gone after the owner acts on it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'

const router = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => router, usePathname: () => '/dashboard' }))
vi.mock('next/image', () => ({ default: () => null }))
vi.mock('next/link', () => ({
  default: ({ children, href, onClick, ...rest }: { children: ReactNode; href: string; onClick?: (e: unknown) => void }) => (
    <a
      href={href}
      {...rest}
      onClick={(e) => {
        e.preventDefault()
        onClick?.(e)
      }}
    >
      {children}
    </a>
  ),
}))
vi.mock('@/hooks/queries/use-dashboard', () => ({
  useDashboard: () => ({
    isLoading: false,
    data: { todayAppointments: [], activation: null, pendingRescheduleCount: 0, quickStats: {}, recentActivity: [] },
  }),
}))
vi.mock('@/hooks/queries/use-tenant', () => ({ useTenant: () => ({ data: { settings: {} } }) }))
vi.mock('@/components/layout/subscription-access', () => ({
  ReadOnlyGuard: ({ children }: { children: ReactNode }) => <>{children}</>,
}))
const { Nothing } = vi.hoisted(() => ({ Nothing: () => null }))
vi.mock('@/components/dashboard/quick-stats', () => ({ QuickStats: Nothing }))
vi.mock('@/components/dashboard/today-appointments', () => ({ TodayAppointments: Nothing }))
vi.mock('@/components/dashboard/financial-summary', () => ({ FinancialSummary: Nothing }))
vi.mock('@/components/dashboard/recent-activity', () => ({ RecentActivity: Nothing }))
vi.mock('@/components/dashboard/upcoming-birthdays-card', () => ({ UpcomingBirthdaysCard: Nothing }))
vi.mock('@/components/dashboard/open-planejamentos-card', () => ({ OpenPlanejamentosCard: Nothing }))
vi.mock('@/components/dashboard/trial-checklist-card', () => ({ TrialChecklistCard: Nothing }))
vi.mock('@/components/dashboard/pending-reschedule-card', () => ({ PendingRescheduleCard: Nothing }))
vi.mock('@/components/dashboard/month-selector', () => ({ MonthSelector: Nothing }))

import { DashboardPageClient } from '../dashboard-page-client'
import { InstallBanner } from '@/components/layout/install-banner'

// A phone browser that has not installed the app, for the install banner.
function stubInstallableMobile() {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => ({ matches: !query.startsWith('(display-mode'), media: query }),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
})

afterEach(() => {
  delete (window as { matchMedia?: unknown }).matchMedia
})

describe('dashboard first-patient highlight', () => {
  it('links the header actions to the URLs that open the patient and appointment forms', () => {
    render(<DashboardPageClient />)

    expect(screen.getByTestId('dashboard-new-patient')).toHaveAttribute('href', '/pacientes?novo=1')
    expect(screen.getByTestId('dashboard-new-appointment')).toHaveAttribute('href', '/agenda?open=new')
  })

  it('highlights "Novo Paciente" with a described hint and drops the parameter from the URL', () => {
    render(<DashboardPageClient highlightFirstPatient />)

    const action = screen.getByTestId('dashboard-new-patient')
    expect(action).toHaveAttribute('data-highlighted', 'true')
    expect(action).toHaveAccessibleDescription(/primeiro paciente/i)
    expect(screen.getByRole('status')).toHaveTextContent('Sua clínica está pronta.')
    expect(router.replace).toHaveBeenCalledWith('/dashboard', { scroll: false })
  })

  it('holds the install banner back while the hint is up, without dismissing it', async () => {
    const user = userEvent.setup()
    stubInstallableMobile()
    render(
      <>
        <InstallBanner />
        <DashboardPageClient highlightFirstPatient />
      </>,
    )
    expect(screen.queryByTestId('install-banner')).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Dispensar dica' }))

    expect(screen.getByTestId('install-banner')).toBeInTheDocument()
    expect(localStorage.getItem('floraclin.install-banner.dismissed')).toBeNull()
  })

  it('leaves the install banner alone on an ordinary visit', () => {
    stubInstallableMobile()
    render(
      <>
        <InstallBanner />
        <DashboardPageClient />
      </>,
    )
    expect(screen.getByTestId('install-banner')).toBeInTheDocument()
  })

  it('lets the install banner back on the next page', () => {
    stubInstallableMobile()
    const { unmount } = render(<DashboardPageClient highlightFirstPatient />)
    unmount()
    render(<InstallBanner />)
    expect(screen.getByTestId('install-banner')).toBeInTheDocument()
  })

  it('goes away once the owner opens the patient form', async () => {
    const user = userEvent.setup()
    render(<DashboardPageClient highlightFirstPatient />)
    await user.click(screen.getByTestId('dashboard-new-patient'))

    expect(screen.getByTestId('dashboard-new-patient')).not.toHaveAttribute('data-highlighted')
    expect(screen.queryByTestId('first-patient-hint')).toBeNull()
  })

  it('goes away when dismissed', async () => {
    const user = userEvent.setup()
    render(<DashboardPageClient highlightFirstPatient />)
    await user.click(screen.getByRole('button', { name: 'Dispensar dica' }))

    expect(screen.queryByTestId('first-patient-hint')).toBeNull()
    expect(screen.getByTestId('dashboard-new-patient')).not.toHaveAccessibleDescription()
  })

  it('shows nothing and leaves the URL alone on an ordinary visit', () => {
    render(<DashboardPageClient />)
    expect(screen.queryByTestId('first-patient-hint')).toBeNull()
    expect(screen.getByTestId('dashboard-new-patient')).not.toHaveAttribute('data-highlighted')
    expect(router.replace).not.toHaveBeenCalled()
  })
})
