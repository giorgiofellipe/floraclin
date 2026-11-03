import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, fireEvent, within } from '@testing-library/react'
import { renderWithProviders } from '@/tests/test-utils'
import type { Patient } from '@/db/queries/patients'
import { PatientDetailContent } from '../patient-detail-content'

const replace = vi.fn()
const push = vi.fn()
let searchParams = new URLSearchParams()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace }),
  usePathname: () => '/pacientes/p1',
  useSearchParams: () => searchParams,
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

function renderContent(tab?: string, role: 'practitioner' | 'receptionist' = 'practitioner') {
  searchParams = new URLSearchParams(tab ? { tab } : {})
  return renderWithProviders(<PatientDetailContent patient={patient} role={role} />)
}

function phoneSectionList() {
  return screen.getByTestId('patient-section-list')
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
  })

  it('follows ?tab= changes from back/forward and in-page links', () => {
    const { rerender } = renderContent('atendimentos')
    searchParams = new URLSearchParams({ tab: 'financeiro' })
    rerender(<PatientDetailContent patient={patient} role="practitioner" />)
    expect(screen.getByText('financial-tab')).toBeInTheDocument()
  })

  it('goes to Financeiro after a charge is saved', () => {
    renderContent()
    paymentOnSuccess!()
    expect(push).toHaveBeenCalledWith('/pacientes/p1?tab=financeiro')
  })

  it('pushes a history entry when a section is opened from the phone hub list', () => {
    renderContent()
    fireEvent.click(within(phoneSectionList()).getByRole('button', { name: 'Atendimentos' }))
    expect(push).toHaveBeenCalledWith('/pacientes/p1?tab=atendimentos')
    expect(replace).not.toHaveBeenCalled()
  })

  it('shows a back link to the hub and the section title inside a section', () => {
    renderContent('financeiro')
    const back = screen.getByRole('link', { name: 'Maria' })
    expect(back).toHaveAttribute('href', '/pacientes/p1')
    expect(screen.getByRole('heading', { name: 'Financeiro' })).toBeInTheDocument()
    expect(screen.queryByTestId('patient-section-list')).toBeNull()
  })

  it('hides Evoluções from the receptionist hub list', () => {
    renderContent(undefined, 'receptionist')
    expect(within(phoneSectionList()).queryByRole('button', { name: 'Evoluções' })).toBeNull()
    expect(within(phoneSectionList()).getByRole('button', { name: 'Atendimentos' })).toBeInTheDocument()
  })
})
