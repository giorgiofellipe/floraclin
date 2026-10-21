import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

const mutate = vi.hoisted(() => vi.fn())
const access = vi.hoisted(() => ({ readOnly: true, openPaywall: vi.fn() }))

vi.mock('@/components/layout/subscription-access', () => ({ useSubscriptionAccess: () => access }))
vi.mock('@/hooks/mutations/use-appointment-mutations', () => {
  const m = () => ({ mutate, mutateAsync: mutate, isPending: false })
  return { useCreateAppointment: m, useUpdateAppointment: m, useUpdateAppointmentStatus: m, useDeleteAppointment: m }
})
vi.mock('@/hooks/mutations/use-patient-mutations', () => ({
  useCreatePatient: () => ({ mutate, mutateAsync: mutate, isPending: false }),
}))
vi.mock('@/hooks/queries/use-tenant', () => ({ useTenant: () => ({ data: null }) }))

import { AppointmentForm } from '../appointment-form'

const APPOINTMENT = {
  id: 'a1',
  tenantId: 't1',
  patientId: 'p1',
  practitionerId: 'u1',
  procedureTypeId: null,
  date: '2026-10-22',
  startTime: '10:00',
  endTime: '11:00',
  status: 'scheduled',
  source: 'internal',
  bookingName: null,
  bookingPhone: null,
  bookingEmail: null,
  notes: 'Retorno',
  createdAt: new Date(),
  updatedAt: new Date(),
  patientName: 'Ana Souza',
  practitionerName: 'Dra. Flora',
  procedureTypeName: null,
}

describe('AppointmentForm in read-only mode', () => {
  it('opens an existing appointment for reading only: fields disabled, no save, a way to the plans', () => {
    render(
      <AppointmentForm
        open
        onOpenChange={() => {}}
        appointment={APPOINTMENT}
        practitioners={[{ id: 'u1', name: 'Dra. Flora' }] as never}
        procedureTypes={[]}
      />,
    )

    expect(screen.getByRole('heading', { name: 'Agendamento' })).toBeInTheDocument()
    expect(screen.getByTestId('appointment-form-fields')).toBeDisabled()
    // The controls themselves, not just the wrapper.
    expect(screen.getByDisplayValue('Retorno')).toBeDisabled()
    for (const button of screen.getByTestId('appointment-form-fields').querySelectorAll('button')) {
      expect(button).toBeDisabled()
    }
    expect(screen.queryByRole('button', { name: /salvar/i })).not.toBeInTheDocument()

    const footer = screen.getByTestId('appointment-form-read-only')
    fireEvent.click(screen.getByRole('button', { name: 'Ver planos' }))
    expect(access.openPaywall).toHaveBeenCalled()
    expect(footer).toBeInTheDocument()
    expect(mutate).not.toHaveBeenCalled()
  })
})
