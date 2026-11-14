/**
 * `/agenda?open=new` (trial checklist, lifecycle email) opens the appointment
 * form on load. It must start like the "Agendar" button: the viewed day at
 * 08:00-08:30, not an empty date and a "NaN:NaN" end time.
 */
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }))
vi.mock('@/components/layout/subscription-access', () => ({
  useSubscriptionAccess: () => ({ readOnly: false, openPaywall: vi.fn() }),
  ReadOnlyGuard: ({ children }: { children: ReactNode }) => <>{children}</>,
  useWriteGuard: () => (action: () => void) => action,
}))
vi.mock('@/hooks/queries/use-appointments', () => ({ useAppointments: () => ({ data: [] }) }))
vi.mock('@/hooks/queries/use-calendar', () => {
  const m = () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false })
  return { useDeleteCalendarBlock: m, useCreateCalendarBlock: m }
})
vi.mock('@/hooks/queries/use-tenant', () => ({ useTenant: () => ({ data: null }) }))
vi.mock('@/hooks/queries/use-patients', () => ({
  usePatientSearch: () => ({ data: [], isFetching: false, isSuccess: true }),
  useRecentPatients: () => ({ data: [] }),
}))
vi.mock('@/hooks/use-is-mobile', () => ({ useIsMobile: () => false, useIsTouch: () => false }))
vi.mock('@/hooks/mutations/use-move-appointment', () => ({ useMoveAppointment: () => ({ move: vi.fn(), canNotify: () => false, isMoving: () => false }) }))
vi.mock('@/hooks/mutations/use-appointment-mutations', () => {
  const m = () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false })
  return { useCreateAppointment: m, useUpdateAppointment: m, useUpdateAppointmentStatus: m, useDeleteAppointment: m }
})
vi.mock('@/hooks/mutations/use-patient-mutations', () => ({
  useCreatePatient: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
}))

import { CalendarView } from '../calendar-view'

describe('CalendarView ?open=new deep link', () => {
  it('opens the new-appointment form on the viewed day with a 08:00-08:30 slot', () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
      <CalendarView
        initialDate="2026-11-20"
        initialView="day"
        practitioners={[{ id: 'u1', fullName: 'Dra. Flora' }]}
        procedureTypes={[]}
        initialAppointments={[]}
        autoOpenNew
        role="owner"
        userId="u1"
      />
      </QueryClientProvider>,
    )

    const dialog = screen.getByRole('dialog')
    expect(dialog).not.toHaveTextContent('NaN')
    expect(dialog).toHaveTextContent('08:00')
    expect(dialog).toHaveTextContent('08:30')
    expect(dialog).toHaveTextContent('20/11/2026')
  })

  it('titles the day in sentence case and shows only the viewed day once', () => {
    // Regression: a CSS `capitalize` turned the title into "20 De Novembro De 2026", and the day grid
    // repeated the date in its own header under the toolbar.
    render(
      <QueryClientProvider client={new QueryClient()}>
        <CalendarView
          initialDate="2026-11-20"
          initialView="day"
          practitioners={[{ id: 'u1', fullName: 'Dra. Flora' }]}
          procedureTypes={[]}
          initialAppointments={[]}
          role="owner"
          userId="u1"
        />
      </QueryClientProvider>,
    )

    expect(screen.getByTestId('calendar-title')).toHaveTextContent(/^Sexta-feira, 20 de novembro$/)
    expect(screen.getAllByText(/20 de novembro/i)).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Mês' })).toBeInTheDocument()
  })
})
