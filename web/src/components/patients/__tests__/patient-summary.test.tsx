import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, fireEvent } from '@testing-library/react'
import { renderWithProviders } from '@/tests/test-utils'
import { PatientSummary } from '../patient-summary'

const mocks = vi.hoisted(() => ({
  groups: vi.fn(),
  finance: vi.fn(),
}))

vi.mock('@/hooks/queries/use-face-diagram-groups', () => ({
  usePatientDiagramGroups: () => mocks.groups(),
}))
vi.mock('@/hooks/queries/use-patient-overview', () => ({
  usePatientAppointments: () => ({ data: [], isLoading: false }),
  usePatientFinancialSummary: () => mocks.finance(),
}))
vi.mock('@/hooks/queries/use-procedures', () => ({
  useProcedures: () => ({ data: [], isLoading: false }),
}))
vi.mock('@/hooks/queries/use-packages', () => ({
  usePatientPackages: () => ({ data: [] }),
}))
vi.mock('@/components/face-diagram/face-diagram-editor', () => ({
  FaceDiagramEditor: () => <div data-testid="diagram" />,
}))

const group = {
  id: 'g1',
  procedureSessionId: null,
  status: 'quote',
  quotationTotal: 1500,
  createdAt: '2026-10-20T15:00:00Z',
  views: [],
}

function summary(amounts: { overdueAmount: number }) {
  mocks.finance.mockReturnValue({
    data: { openAmount: 500, nextDueDate: null, ...amounts },
    isLoading: false,
  })
}

describe('PatientSummary', () => {
  beforeEach(() => {
    mocks.groups.mockReturnValue({ data: [group], isLoading: false })
    summary({ overdueAmount: 0 })
  })

  it('navigates to diagramas from the diagram card link', () => {
    const onNavigate = vi.fn()
    renderWithProviders(<PatientSummary patientId="p1" role="owner" onNavigate={onNavigate} />)
    const card = screen.getByText('Diagramas faciais').closest('section')!
    fireEvent.click(card.querySelector('button')!)
    expect(onNavigate).toHaveBeenCalledWith('diagramas')
  })

  it('shows the overdue amount in amber only when it is above zero', () => {
    const { unmount } = renderWithProviders(
      <PatientSummary patientId="p1" role="owner" onNavigate={vi.fn()} />,
    )
    expect(screen.getByText(/R\$\s*0,00/).className).not.toContain('amber')
    unmount()

    summary({ overdueAmount: 120 })
    renderWithProviders(<PatientSummary patientId="p1" role="owner" onNavigate={vi.fn()} />)
    expect(screen.getByText(/R\$\s*120,00/).className).toContain('amber')
  })

  it('tells the user the financial summary failed instead of loading forever', () => {
    mocks.finance.mockReturnValue({ data: undefined, isLoading: false, isError: true })
    renderWithProviders(<PatientSummary patientId="p1" role="owner" onNavigate={vi.fn()} />)
    expect(screen.getByText('Não foi possível carregar o financeiro.')).toBeInTheDocument()
  })
})
