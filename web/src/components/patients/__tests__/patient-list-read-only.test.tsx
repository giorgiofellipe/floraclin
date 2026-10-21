import { describe, it, expect, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithProviders as render } from '@/tests/test-utils'
import { SubscriptionAccessProvider } from '@/components/layout/subscription-access'
import { PatientList } from '../patient-list'

// `?novo=1` is the deep link used by the trial checklist and a lifecycle
// email. In read-only mode it used to open the create form anyway, whose
// save could only fail with a 402.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
  usePathname: () => '/pacientes',
  useSearchParams: () => new URLSearchParams('novo=1&nome=Ana'),
}))
vi.mock('@/actions/patients', () => ({ deletePatientAction: vi.fn() }))
vi.mock('../patient-form', () => ({
  PatientForm: ({ open }: { open: boolean }) => (open ? <div data-testid="patient-form-open" /> : null),
}))

const EMPTY = { data: [], total: 0, page: 1, limit: 20, totalPages: 0 }

function renderList(readOnly: boolean) {
  return render(
    <SubscriptionAccessProvider readOnly={readOnly} reason={readOnly ? 'trial' : null} tenantId="t1" canSubscribe plans={[]} winback={null}>
      <PatientList result={EMPTY as never} />
    </SubscriptionAccessProvider>,
  )
}

describe('PatientList ?novo=1 deep link', () => {
  it('opens the create form while the subscription is active', () => {
    renderList(false)
    expect(screen.getByTestId('patient-form-open')).toBeInTheDocument()
  })

  it('opens nothing in read-only mode and shows Novo Paciente as unavailable', () => {
    renderList(true)
    expect(screen.queryByTestId('patient-form-open')).not.toBeInTheDocument()
    expect(screen.getByTestId('read-only-guard')).toHaveAccessibleName('Novo Paciente')
  })
})
