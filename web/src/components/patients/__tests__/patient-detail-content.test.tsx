import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, fireEvent } from '@testing-library/react'
import { renderWithProviders } from '@/tests/test-utils'
import type { Patient } from '@/db/queries/patients'
import { PatientDetailContent } from '../patient-detail-content'

const replace = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace }),
  usePathname: () => '/pacientes/p1',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }))
vi.mock('@/hooks/queries/use-appointments', () => ({
  usePractitioners: () => ({ data: [] }),
  useAppointmentProcedureTypes: () => ({ data: [] }),
}))

let paymentOnSuccess: (() => void) | undefined
vi.mock('@/components/financial/payment-form', () => ({
  PaymentForm: (p: { onSuccess: () => void }) => {
    paymentOnSuccess = p.onSuccess
    return null
  },
}))
vi.mock('@/components/scheduling/appointment-form', () => ({ AppointmentForm: () => null }))
vi.mock('@/components/clinical-documents/issue-document-dialog', () => ({ IssueDocumentDialog: () => null }))
vi.mock('../request-documents-dialog', () => ({ RequestDocumentsDialog: () => null }))
vi.mock('../patient-summary', () => ({ PatientSummary: () => <div>resumo-cards</div> }))
vi.mock('../patient-procedures-tab', () => ({ PatientProceduresTab: () => <div>procedures-tab</div> }))
vi.mock('../patient-financial-tab', () => ({ PatientFinancialTab: () => <div>financial-tab</div> }))

const patient = {
  id: 'p1',
  fullName: 'Maria da Silva',
  phone: '(11) 98765-4321',
  email: null,
  cpf: null,
  birthDate: null,
  gender: null,
} as unknown as Patient

function renderContent(activeTab?: string) {
  return renderWithProviders(
    <PatientDetailContent patient={patient} activeTab={activeTab} role="practitioner" />,
  )
}

describe('PatientDetailContent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    paymentOnSuccess = undefined
  })

  it('shows the summary by default', () => {
    renderContent()
    expect(screen.getByText('resumo-cards')).toBeInTheDocument()
  })

  it('renders the procedures tab for ?tab=atendimentos', () => {
    renderContent('atendimentos')
    expect(screen.getByText('procedures-tab')).toBeInTheDocument()
  })

  it('falls back to the summary for the removed procedimentos deep link', () => {
    renderContent('procedimentos')
    expect(screen.getByText('resumo-cards')).toBeInTheDocument()
  })

  it('writes ?tab=financeiro when the section is selected', () => {
    renderContent()
    fireEvent.click(screen.getByTestId('patient-section-financeiro'))
    expect(replace).toHaveBeenCalledWith('/pacientes/p1?tab=financeiro', { scroll: false })
    expect(screen.getByText('financial-tab')).toBeInTheDocument()
  })

  it('goes to Financeiro after a charge is saved', () => {
    renderContent()
    paymentOnSuccess!()
    expect(replace).toHaveBeenCalledWith('/pacientes/p1?tab=financeiro', { scroll: false })
  })
})
