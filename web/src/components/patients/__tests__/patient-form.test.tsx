import { describe, it, expect, vi } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders as render } from '@/tests/test-utils'
import { SubscriptionAccessProvider } from '@/components/layout/subscription-access'
import { PatientForm } from '../patient-form'
import type { Patient } from '@/db/queries/patients'

const push = vi.fn()
const createMutate = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, refresh: vi.fn(), back: vi.fn() }),
}))

vi.mock('@/hooks/mutations/use-patient-mutations', () => ({
  useCreatePatient: () => ({ mutateAsync: createMutate, isPending: false }),
  useUpdatePatient: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeletePatient: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))

function renderAs(role: string, ui: React.ReactElement) {
  return render(
    <SubscriptionAccessProvider readOnly={false} reason={null} tenantId="t1" canSubscribe plans={[]} role={role}>
      {ui}
    </SubscriptionAccessProvider>,
  )
}

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

  it('opens the new patient record after Cadastrar', async () => {
    createMutate.mockResolvedValue({ success: true, data: { id: 'new-id' } })
    render(<PatientForm open onOpenChange={vi.fn()} />)

    fireEvent.change(screen.getByTestId('patient-form-name'), { target: { value: 'Ana Nova' } })
    fireEvent.change(screen.getByTestId('patient-form-phone'), { target: { value: '(11) 99999-0000' } })
    fireEvent.click(screen.getByTestId('patient-form-submit'))

    await waitFor(() => expect(push).toHaveBeenCalledWith('/pacientes/new-id'))
  })

  it('offers Excluir paciente when editing only to roles the delete API accepts', () => {
    const patient = { id: 'p1', fullName: 'Maria Silva', phone: '5511999990000' } as Patient
    const { unmount } = renderAs('receptionist', <PatientForm open onOpenChange={vi.fn()} patient={patient} />)
    expect(screen.getByTestId('patient-delete-button')).toBeInTheDocument()
    unmount()

    renderAs('financial', <PatientForm open onOpenChange={vi.fn()} patient={patient} inline />)
    expect(screen.queryByTestId('patient-delete-button')).not.toBeInTheDocument()
  })
})
