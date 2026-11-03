import { describe, it, expect, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithProviders } from '@/tests/test-utils'
import { PatientDetailPageClient } from '../patient-detail-page-client'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/pacientes/p1',
  useSearchParams: () => new URLSearchParams(),
  notFound: vi.fn(),
}))
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }))
vi.mock('@/hooks/queries/use-appointments', () => ({
  usePractitioners: () => ({ data: [] }),
  useAppointmentProcedureTypes: () => ({ data: [] }),
}))
vi.mock('@/hooks/queries/use-patients', () => ({
  usePatient: () => ({
    isLoading: false,
    data: { id: 'p1', fullName: 'Maria da Silva', phone: '(11) 98765-4321' },
  }),
}))
vi.mock('@/hooks/queries/use-procedures', () => ({
  useProcedures: () => ({ data: [{ id: 'x', status: 'in_progress' }] }),
}))
vi.mock('@/components/patients/patient-summary', () => ({ PatientSummary: () => null }))
vi.mock('@/components/financial/payment-form', () => ({ PaymentForm: () => null }))
vi.mock('@/components/scheduling/appointment-form', () => ({ AppointmentForm: () => null }))
vi.mock('@/components/clinical-documents/issue-document-dialog', () => ({ IssueDocumentDialog: () => null }))
vi.mock('@/components/patients/request-documents-dialog', () => ({ RequestDocumentsDialog: () => null }))

describe('PatientDetailPageClient', () => {
  it('offers "Continuar Atendimento" when the only procedure is in progress', () => {
    renderWithProviders(<PatientDetailPageClient patientId="p1" role="practitioner" />)
    expect(screen.getAllByText('Continuar Atendimento').length).toBeGreaterThan(0)
  })
})
