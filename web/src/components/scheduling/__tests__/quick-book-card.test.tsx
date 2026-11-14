/**
 * Tapping a free slot books in a few taps: the time is the slot, the end follows
 * the procedure, and a name with no match plus a phone registers the patient.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const createAppointment = vi.hoisted(() => vi.fn(async () => ({ data: { id: 'a1' } })))
const createPatient = vi.hoisted(() => vi.fn(async () => ({ data: { id: 'new-patient' } })))
const search = vi.hoisted(() => ({ data: [] as { id: string; fullName: string; phone: string }[] }))

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/hooks/use-is-mobile', () => ({ useIsTouch: () => true }))
vi.mock('@/hooks/mutations/use-appointment-mutations', () => ({
  useCreateAppointment: () => ({ mutateAsync: createAppointment, isPending: false }),
}))
vi.mock('@/hooks/mutations/use-patient-mutations', () => ({
  useCreatePatient: () => ({ mutateAsync: createPatient, isPending: false }),
}))
vi.mock('@/hooks/queries/use-patients', () => ({
  usePatientSearch: () => ({ data: search.data, isFetching: false, isSuccess: true }),
  useRecentPatients: () => ({ data: [{ id: 'p-recent', fullName: 'Ana Souza', phone: '11999990000' }] }),
}))

import { QuickBookCard } from '../quick-book-card'

const PROPS = {
  open: true,
  onOpenChange: vi.fn(),
  anchor: null,
  date: '2026-11-17',
  startTime: '10:30',
  defaultPractitionerId: 'u1',
  practitioners: [{ id: 'u1', fullName: 'Dra. Flora' }],
  procedureTypes: [{ id: 'pt-toxina', name: 'Toxina', estimatedDurationMin: 45 }],
  onMoreOptions: vi.fn(),
}

beforeEach(() => {
  vi.clearAllMocks()
  search.data = []
})

describe('QuickBookCard', () => {
  it('registers a typed name with a phone as a new patient and books the slot for the procedure length', async () => {
    const user = userEvent.setup()
    render(<QuickBookCard {...PROPS} />)

    await user.type(screen.getByTestId('patient-picker-search'), 'Bruna Lima')
    // No match: the phone field shows without an extra "Criar paciente" tap.
    await user.type(await screen.findByTestId('patient-picker-phone'), '11988887777')
    await user.click(screen.getByRole('button', { name: 'Toxina' }))
    expect(screen.getByTestId('quick-book-when')).toHaveTextContent('10:30-11:15')
    await user.click(screen.getByTestId('quick-book-submit'))

    await waitFor(() => expect(createAppointment).toHaveBeenCalled())
    expect(createPatient).toHaveBeenCalledWith({ fullName: 'Bruna Lima', phone: '(11) 98888-7777' })
    expect(createAppointment).toHaveBeenCalledWith({
      patientId: 'new-patient',
      bookingName: 'Bruna Lima',
      practitionerId: 'u1',
      procedureTypeId: 'pt-toxina',
      date: '2026-11-17',
      startTime: '10:30',
      endTime: '11:15',
    })
  })

  it('books a recent patient from its chip without searching', async () => {
    const user = userEvent.setup()
    render(<QuickBookCard {...PROPS} />)

    await user.click(screen.getByRole('button', { name: 'Ana Souza' }))
    await user.click(screen.getByTestId('quick-book-submit'))

    await waitFor(() => expect(createAppointment).toHaveBeenCalledWith(expect.objectContaining({ patientId: 'p-recent', endTime: '11:00' })))
    expect(createPatient).not.toHaveBeenCalled()
  })
})
