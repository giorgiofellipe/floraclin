/**
 * `/agenda?open=new` (trial checklist, lifecycle email) opens the appointment
 * form on load. It must start like the "Agendar" button: the viewed day at
 * 08:00-08:30, not an empty date and a "NaN:NaN" end time.
 */
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }))
vi.mock('@/components/layout/subscription-access', () => ({
  useSubscriptionAccess: () => ({ readOnly: false, openPaywall: vi.fn() }),
  ReadOnlyGuard: ({ children }: { children: ReactNode }) => <>{children}</>,
}))
vi.mock('@/hooks/queries/use-appointments', () => ({ useAppointments: () => ({ data: [] }) }))
vi.mock('@/hooks/queries/use-calendar', () => {
  const m = () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false })
  return { useDeleteCalendarBlock: m, useCreateCalendarBlock: m }
})
vi.mock('@/hooks/queries/use-tenant', () => ({ useTenant: () => ({ data: null }) }))
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
      <CalendarView
        initialDate="2026-11-20"
        initialView="day"
        practitioners={[{ id: 'u1', fullName: 'Dra. Flora' }]}
        procedureTypes={[]}
        initialAppointments={[]}
        autoOpenNew
        role="owner"
        userId="u1"
      />,
    )

    const dialog = screen.getByRole('dialog')
    expect(dialog).not.toHaveTextContent('NaN')
    expect(dialog).toHaveTextContent('08:00')
    expect(dialog).toHaveTextContent('08:30')
    expect(dialog).toHaveTextContent('20/11/2026')
  })
})
