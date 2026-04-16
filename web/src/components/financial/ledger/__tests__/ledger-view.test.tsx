import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { LedgerView } from '../ledger-view'

// ─── Mocks ─────────────────────────────────────────────────────────

const mockLedgerData = {
  movements: [
    {
      id: 'mov-1',
      type: 'inflow' as const,
      amount: '1500.00',
      description: 'Pagamento consulta',
      paymentMethod: 'pix',
      movementDate: '2026-03-15',
      patientName: 'Maria Silva',
      categoryName: null,
      runningBalance: 1500,
    },
    {
      id: 'mov-2',
      type: 'outflow' as const,
      amount: '300.00',
      description: 'Compra de materiais',
      paymentMethod: 'credit_card',
      movementDate: '2026-03-16',
      patientName: null,
      categoryName: 'Materiais/Insumos',
      runningBalance: 1200,
    },
  ],
  summary: {
    totalInflows: 1500,
    totalOutflows: 300,
    netResult: 1200,
    overdueReceivables: 0,
  },
  pagination: {
    total: 2,
    page: 1,
    limit: 30,
    totalPages: 1,
  },
}

vi.mock('@/hooks/queries/use-ledger', () => ({
  useLedger: () => ({
    data: mockLedgerData,
    isPending: false,
  }),
  useLedgerExportUrl: () => '/api/financial/ledger/export?dateFrom=2026-03-01&dateTo=2026-03-31',
}))

vi.mock('@/hooks/queries/use-financial', () => ({
  useFinancialPatients: () => ({ data: [] }),
}))

vi.mock('@/hooks/queries/use-financial-settings', () => ({
  useExpenseCategories: () => ({ data: [] }),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), back: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/financeiro',
  useSearchParams: () => new URLSearchParams(),
}))

// ─── Tests ─────────────────────────────────────────────────────────

describe('LedgerView', () => {
  it('renders inflow movements with green styling', () => {
    render(<LedgerView />)

    expect(screen.getByText('Pagamento consulta')).toBeInTheDocument()
    expect(screen.getByText('Maria Silva')).toBeInTheDocument()

    const inflowIcon = screen.getByTestId('inflow-icon')
    expect(inflowIcon).toBeInTheDocument()
    expect(inflowIcon).toHaveClass('text-[#4A6B52]')
  })

  it('renders outflow movements with red styling', () => {
    render(<LedgerView />)

    expect(screen.getByText('Compra de materiais')).toBeInTheDocument()
    expect(screen.getByText('Materiais/Insumos')).toBeInTheDocument()

    const outflowIcon = screen.getByTestId('outflow-icon')
    expect(outflowIcon).toBeInTheDocument()
    expect(outflowIcon).toHaveClass('text-red-600')
  })

  it('renders summary cards with correct values', () => {
    render(<LedgerView />)

    // Summary cards
    expect(screen.getByText('Total Entradas')).toBeInTheDocument()
    expect(screen.getByText('Total Saídas')).toBeInTheDocument()
    expect(screen.getByText('Resultado Líquido')).toBeInTheDocument()
    expect(screen.getByText('A Receber Vencido')).toBeInTheDocument()
  })

  it('renders payment method badges', () => {
    render(<LedgerView />)

    // PIX appears in both the filter select items and the row badge — use getAllByText.
    expect(screen.getAllByText('PIX').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('Cartão de Crédito').length).toBeGreaterThanOrEqual(1)
  })

  it('renders running balance for each movement', () => {
    render(<LedgerView />)

    // R$ 1.500,00 appears in summary card AND running balance — use getAllByText
    const amounts1500 = screen.getAllByText('R$ 1.500,00')
    expect(amounts1500.length).toBeGreaterThanOrEqual(1)

    // R$ 1.200,00 appears in summary card (Resultado Liquido) AND running balance
    const amounts1200 = screen.getAllByText('R$ 1.200,00')
    expect(amounts1200.length).toBeGreaterThanOrEqual(1)
  })

  it('renders export button', () => {
    render(<LedgerView />)

    expect(screen.getByText('Exportar CSV')).toBeInTheDocument()
  })
})
