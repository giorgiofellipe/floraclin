/**
 * The dashboard, quick create, the trial checklist and a lifecycle email link
 * to NEW_APPOINTMENT_PATH. CalendarView opens the form from that param
 * (calendar-view-deep-link.test.tsx); the page must not also read its value
 * as an appointment id to open.
 */
import { describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'

const calendarProps = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }))

vi.mock('next/navigation', async () => {
  const { NEW_APPOINTMENT_PATH } = await import('@/lib/deep-links')
  return { useSearchParams: () => new URLSearchParams(NEW_APPOINTMENT_PATH.split('?')[1]) }
})
vi.mock('@/hooks/use-is-mobile', () => ({ useIsMobile: () => false }))
vi.mock('@/hooks/queries/use-appointments', () => {
  const loaded = () => ({ data: [], isLoading: false })
  return { useAppointments: loaded, usePractitioners: loaded, useAppointmentProcedureTypes: loaded }
})
vi.mock('@/hooks/queries/use-calendar', () => ({ useCalendarBlocks: () => ({ data: [] }) }))
vi.mock('@/components/scheduling/calendar-view', () => ({
  CalendarView: (props: Record<string, unknown>) => {
    calendarProps.current = props
    return null
  },
}))

import { AgendaPageClient } from '../agenda-page-client'

describe('agenda new-appointment deep link', () => {
  it('does not treat NEW_APPOINTMENT_PATH as an appointment to open', () => {
    render(<AgendaPageClient role="owner" userId="u1" />)

    expect(calendarProps.current).toMatchObject({ autoOpenAppointmentId: undefined })
  })
})
