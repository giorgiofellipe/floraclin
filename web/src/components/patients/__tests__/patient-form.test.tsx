import { describe, it, expect, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithProviders as render } from '@/tests/test-utils'
import { PatientForm } from '../patient-form'
import type { Patient } from '@/db/queries/patients'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
}))

vi.mock('@/hooks/mutations/use-patient-mutations', () => ({
  useCreatePatient: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdatePatient: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))

describe('PatientForm', () => {
  it('shows a stored canonical phone in national form when editing', () => {
    // The phone mask keeps the first 11 digits, so a raw 5547988443635 would
    // render as (55) 47988-4436.
    const patient = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      fullName: 'Maria Silva',
      phone: '5547988443635',
      phoneSecondary: '5547999990000',
    } as Patient

    render(<PatientForm open onOpenChange={vi.fn()} patient={patient} inline />)

    expect(screen.getByTestId('patient-form-phone')).toHaveValue('(47) 98844-3635')
    expect(screen.getByLabelText('Telefone secundário')).toHaveValue('(47) 99999-0000')
  })
})
