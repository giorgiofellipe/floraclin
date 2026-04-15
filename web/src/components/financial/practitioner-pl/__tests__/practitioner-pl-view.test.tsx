import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PractitionerPLView } from '../practitioner-pl-view'

// ─── Mocks ─────────────────────────────────────────────────────────

const mockPLData = [
  {
    practitionerId: 'pract-1',
    practitionerName: 'Dra. Ana Oliveira',
    revenueGenerated: 25000,
    revenueCollected: 18000,
    procedureCount: 15,
    averageTicket: 1666.67,
    byProcedureType: [
      { name: 'Botox', revenue: 15000, count: 10 },
      { name: 'Preenchimento', revenue: 10000, count: 5 },
    ],
  },
  {
    practitionerId: 'pract-2',
    practitionerName: 'Dr. Carlos Santos',
    revenueGenerated: 12000,
    revenueCollected: 12000,
    procedureCount: 8,
    averageTicket: 1500,
    byProcedureType: [
      { name: 'Bioestimulador', revenue: 12000, count: 8 },
    ],
  },
]

vi.mock('@/hooks/queries/use-practitioner-pl', () => ({
  usePractitionerPL: () => ({
    data: mockPLData,
    isPending: false,
  }),
}))

vi.mock('@/hooks/queries/use-appointments', () => ({
  usePractitioners: () => ({
    data: [
      { id: 'pract-1', name: 'Dra. Ana Oliveira' },
      { id: 'pract-2', name: 'Dr. Carlos Santos' },
    ],
  }),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), back: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/financeiro',
  useSearchParams: () => new URLSearchParams(),
}))

// ─── Tests ─────────────────────────────────────────────────────────

describe('PractitionerPLView', () => {
  it('renders practitioner cards', () => {
    render(<PractitionerPLView />)

    expect(screen.getByText('Dra. Ana Oliveira')).toBeInTheDocument()
    expect(screen.getByText('Dr. Carlos Santos')).toBeInTheDocument()
  })

  it('renders dual attribution metrics (generated vs collected)', () => {
    render(<PractitionerPLView />)

    // Labels for dual attribution
    const generatedLabels = screen.getAllByText('Receita Gerada')
    const collectedLabels = screen.getAllByText('Receita Recebida')
    expect(generatedLabels).toHaveLength(2)
    expect(collectedLabels).toHaveLength(2)

    // Attribution type indicators
    const accrualLabels = screen.getAllByText('Competência')
    const cashLabels = screen.getAllByText('Caixa')
    expect(accrualLabels).toHaveLength(2)
    expect(cashLabels).toHaveLength(2)
  })

  it('renders procedure count and average ticket', () => {
    render(<PractitionerPLView />)

    const procedureCounts = screen.getAllByTestId('procedure-count')
    expect(procedureCounts[0]).toHaveTextContent('15')
    expect(procedureCounts[1]).toHaveTextContent('8')
  })

  it('renders procedure type breakdown tables', () => {
    render(<PractitionerPLView />)

    expect(screen.getByText('Botox')).toBeInTheDocument()
    expect(screen.getByText('Preenchimento')).toBeInTheDocument()
    expect(screen.getByText('Bioestimulador')).toBeInTheDocument()
  })
})
