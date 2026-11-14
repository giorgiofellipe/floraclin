/**
 * The edit dialog's red button used to hard-delete the appointment behind a
 * native confirm, next to a grey "Cancelar" that only closed the dialog. It
 * now cancels (keeping history for the cancellation and no-show reports), and
 * deleting sits behind the overflow menu.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const statusMutate = vi.hoisted(() => vi.fn(async () => ({})))
const deleteMutate = vi.hoisted(() => vi.fn(async () => ({})))

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }))
vi.mock('@/components/layout/subscription-access', () => ({ useSubscriptionAccess: () => ({ readOnly: false, openPaywall: vi.fn() }) }))
vi.mock('@/hooks/mutations/use-appointment-mutations', () => {
  const m = () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false })
  return {
    useCreateAppointment: m,
    useUpdateAppointment: m,
    useUpdateAppointmentStatus: () => ({ mutateAsync: statusMutate, isPending: false }),
    useDeleteAppointment: () => ({ mutateAsync: deleteMutate, isPending: false }),
  }
})
vi.mock('@/hooks/mutations/use-patient-mutations', () => ({ useCreatePatient: () => ({ mutateAsync: vi.fn(), isPending: false }) }))
vi.mock('@/hooks/queries/use-tenant', () => ({ useTenant: () => ({ data: null }) }))
vi.mock('@/hooks/queries/use-patients', () => ({
  usePatientSearch: () => ({ data: [], isFetching: false, isSuccess: true }),
  useRecentPatients: () => ({ data: [] }),
}))

import { AppointmentForm } from '../appointment-form'
import type { AppointmentWithDetails } from '@/db/queries/appointments'

const APPOINTMENT = {
  id: 'a1', tenantId: 't1', patientId: 'p1', practitionerId: 'u1', procedureTypeId: null, date: '2026-11-17', startTime: '10:00',
  endTime: '11:00', status: 'scheduled', source: 'internal', bookingName: null, bookingPhone: null, bookingEmail: null, notes: null,
  createdAt: new Date(), updatedAt: new Date(), patientName: 'Ana Souza', practitionerName: 'Dra. Flora', procedureTypeName: null,
} as AppointmentWithDetails

beforeEach(() => vi.clearAllMocks())

function renderForm() {
  render(<AppointmentForm open onOpenChange={vi.fn()} appointment={APPOINTMENT} practitioners={[{ id: 'u1', fullName: 'Dra. Flora' }]} procedureTypes={[]} />)
}

describe('AppointmentForm edit footer', () => {
  it('"Cancelar agendamento" sets the status to cancelled and deletes nothing', async () => {
    renderForm()
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar agendamento' }))

    expect(statusMutate).toHaveBeenCalledWith({ id: 'a1', status: 'cancelled' })
    expect(deleteMutate).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'Cancelar' })).not.toBeInTheDocument()
  })

  it('deletes only from the overflow menu, after a confirmation', async () => {
    const user = userEvent.setup()
    renderForm()
    await user.click(screen.getByRole('button', { name: 'Mais opções do agendamento' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Excluir agendamento' }))
    expect(deleteMutate).not.toHaveBeenCalled()

    await user.click(screen.getByTestId('confirm-delete-appointment'))
    expect(deleteMutate).toHaveBeenCalledWith('a1')
  })
})
