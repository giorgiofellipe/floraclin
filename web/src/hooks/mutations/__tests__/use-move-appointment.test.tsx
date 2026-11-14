import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { queryKeys } from '@/hooks/queries/query-keys'
import type { AppointmentWithDetails } from '@/db/queries/appointments'

const toast = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), warning: vi.fn(), dismiss: vi.fn() }))
vi.mock('sonner', () => ({ toast }))
vi.mock('@/hooks/queries/use-tenant', () => ({ useTenant: () => ({ data: { settings: {} } }) }))

import { useMoveAppointment } from '../use-move-appointment'

const LIST_KEY = queryKeys.appointments.list(undefined, '2026-11-16', '2026-11-22')
const appointment = {
  id: 'a1', date: '2026-11-17', startTime: '09:00:00', endTime: '09:30:00', status: 'confirmed', patientName: 'Ana', bookingName: null,
} as AppointmentWithDetails

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
  client.setQueryData(LIST_KEY, [appointment])
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  const { result } = renderHook(() => useMoveAppointment(), { wrapper })
  return { client, result }
}

const fetchMock = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

describe('useMoveAppointment', () => {
  it('shows the card at the new slot at once and puts it back when the server refuses the move', async () => {
    // A drop onto a taken slot or a block gets a 409; the card must not stay where it was dropped.
    let refuse!: (value: unknown) => void
    fetchMock.mockReturnValueOnce(new Promise((resolve) => (refuse = resolve)))
    const { client, result } = setup()

    act(() => { void result.current.move(appointment, { date: '2026-11-18', startTime: '10:00', endTime: '10:30' }) })

    await waitFor(() =>
      expect(client.getQueryData<AppointmentWithDetails[]>(LIST_KEY)?.[0]).toMatchObject({ date: '2026-11-18', startTime: '10:00' }),
    )
    await act(async () => refuse({ ok: false, json: async () => ({ error: 'Horário indisponível para este profissional.' }) }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Horário indisponível para este profissional.'))
    expect(client.getQueryData<AppointmentWithDetails[]>(LIST_KEY)?.[0]).toMatchObject({ date: '2026-11-17', startTime: '09:00:00' })
  })

  it('undo is one request that restores the slot and the confirmation state the move reset', async () => {
    // Regression: undo restored the slot, then set the status in a second call, leaving the
    // confirmation fields cleared (or the status unrestored when the second call failed).
    const previous = { status: 'confirmed', confirmedAt: '2026-11-15T10:00:00.000Z', confirmationSentAt: null, confirmationMessageId: null }
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ success: true, data: { updatedAt: '2026-11-16T12:00:00.000Z' }, previous }) })
    const { result } = setup()

    act(() => { void result.current.move(appointment, { date: '2026-11-18', startTime: '10:00', endTime: '10:30' }) })
    await waitFor(() => expect(toast.success).toHaveBeenCalled())

    act(() => toast.success.mock.calls[0][1].action.onClick())
    await waitFor(() => expect(toast.success).toHaveBeenLastCalledWith('Reagendamento desfeito'))

    const calls = fetchMock.mock.calls.map(([url, init]) => [url, JSON.parse(init.body)])
    expect(calls).toEqual([
      ['/api/appointments/a1', { date: '2026-11-18', startTime: '10:00', endTime: '10:30', notifyPatient: false }],
      [
        '/api/appointments/a1',
        { date: '2026-11-17', startTime: '09:00', endTime: '09:30', notifyPatient: false, expectedUpdatedAt: '2026-11-16T12:00:00.000Z', restore: previous },
      ],
    ])
  })
})
