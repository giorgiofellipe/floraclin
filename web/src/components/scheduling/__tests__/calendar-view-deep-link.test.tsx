/**
 * `/agenda?open=new` (quick create, trial checklist, lifecycle email) opens the
 * appointment form. It must start like the "Agendar" button: the viewed day at
 * 08:00-08:30, not an empty date and a "NaN:NaN" end time.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'

const route = vi.hoisted(() => ({ search: '', replace: vi.fn() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: route.replace }),
  usePathname: () => '/agenda',
  useSearchParams: () => new URLSearchParams(route.search),
}))
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
import { NEW_APPOINTMENT_PATH } from '@/lib/deep-links'

const calendar = () => (
  <CalendarView
    initialDate="2026-11-20"
    initialView="day"
    practitioners={[{ id: 'u1', fullName: 'Dra. Flora' }]}
    procedureTypes={[]}
    initialAppointments={[]}
    role="owner"
    userId="u1"
  />
)

describe('CalendarView ?open=new deep link', () => {
  beforeEach(() => {
    route.search = NEW_APPOINTMENT_PATH.split('?')[1]
    route.replace.mockClear()
  })

  it('opens the new-appointment form on the viewed day with a 08:00-08:30 slot', () => {
    render(calendar())

    const dialog = screen.getByRole('dialog')
    expect(dialog).not.toHaveTextContent('NaN')
    expect(dialog).toHaveTextContent('08:00')
    expect(dialog).toHaveTextContent('08:30')
    expect(dialog).toHaveTextContent('20/11/2026')
  })

  // Quick create links to the agenda while it is already on screen.
  it('opens the form when the param arrives after the agenda is on screen', () => {
    route.search = 'date=2026-11-20&view=day'
    const { rerender } = render(calendar())
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    route.search = 'date=2026-11-20&view=day&open=new'
    rerender(calendar())
    expect(screen.getByRole('dialog')).toHaveTextContent('20/11/2026')
  })

  // Left in the URL, Back or a refresh would open the form again.
  it('drops open=new on close and keeps the day and view', async () => {
    route.search = 'date=2026-11-20&view=day&open=new&patient=p1&patientName=Ana'
    render(calendar())
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }))

    expect(route.replace).toHaveBeenCalledWith('/agenda?date=2026-11-20&view=day', { scroll: false })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
