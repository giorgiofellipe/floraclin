import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { PatientFinancialTab } from '../patient-financial-tab'

// ─── Mocks ─────────────────────────────────────────────────────────

vi.mock('@/components/financial/payment-form', () => ({
  PaymentForm: () => null,
}))

vi.mock('@/components/financial/installment-table', () => ({
  InstallmentTable: () => <div data-testid="installment-table">InstallmentTable</div>,
}))

function makeEntry(overrides: Record<string, unknown> = {}) {
  return {
    id: 'entry-1',
    patientId: 'patient-1',
    patientName: 'Maria Silva',
    description: 'Botox frontal',
    totalAmount: '1000.00',
    installmentCount: 2,
    status: 'pending',
    notes: null,
    createdAt: new Date('2026-01-15'),
    paidInstallments: 0,
    totalFineAmount: 0,
    totalInterestAmount: 0,
    totalAmountPaid: 0,
    isOverdue: false,
    isPartial: false,
    renegotiatedAt: null,
    renegotiationLinks: [],
    ...overrides,
  }
}

function setup(entries: ReturnType<typeof makeEntry>[] = [makeEntry()]) {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok: true,
    json: async () => ({ data: entries, total: entries.length }),
  } as Response)

  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <PatientFinancialTab patientId="patient-1" patientName="Maria Silva" />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.restoreAllMocks()
})

// ─── Tests ─────────────────────────────────────────────────────────

describe('PatientFinancialTab', () => {
  it('renders charges with penalty badges for overdue entries', async () => {
    setup([
      makeEntry({
        id: 'entry-overdue',
        status: 'overdue',
        isOverdue: true,
        totalFineAmount: 20,
        totalInterestAmount: 5.5,
      }),
    ])

    const badge = await screen.findByTestId('penalty-badge')
    expect(badge).toHaveTextContent('Multa')
    expect(badge).toHaveTextContent('Juros')
  })

  it('renders penalty badge as "Encargos pagos" for paid entries with no remaining penalties', async () => {
    setup([
      makeEntry({
        id: 'entry-paid',
        status: 'paid',
        paidInstallments: 2,
        totalFineAmount: 0,
        totalInterestAmount: 0,
        totalAmountPaid: 1000,
      }),
    ])

    const badge = await screen.findByTestId('penalty-badge')
    expect(badge).toHaveTextContent('Encargos pagos')
  })

  it('does not render penalty badge when no penalties on pending entry', async () => {
    setup([makeEntry({ status: 'pending', totalFineAmount: 0, totalInterestAmount: 0 })])

    // Wait for data to load
    await screen.findByText('Botox frontal')

    expect(screen.queryByTestId('penalty-badge')).toBeNull()
  })

  it('shows renegotiation "Renegociado" link when entry was renegotiated', async () => {
    setup([
      makeEntry({
        id: 'entry-old',
        status: 'renegotiated',
        renegotiationLinks: [
          { originalEntryId: 'entry-old', newEntryId: 'entry-new-1234', newEntryDescription: 'Renegociacao' },
        ],
      }),
    ])

    const link = await screen.findByTestId('renegotiation-to-link')
    expect(link).toHaveTextContent('Renegociado')
    expect(link).toHaveTextContent('#entry-ne')
  })

  it('shows "Renegociacao de" link when entry originates from renegotiation', async () => {
    setup([
      makeEntry({
        id: 'entry-new',
        status: 'pending',
        renegotiationLinks: [
          { originalEntryId: 'entry-old-abcd', newEntryId: 'entry-new' },
        ],
      }),
    ])

    const link = await screen.findByTestId('renegotiation-from-link')
    expect(link).toHaveTextContent('Renegociacao de')
    expect(link).toHaveTextContent('#entry-ol')
  })

  it('shows the "Nova Cobranca" button', async () => {
    setup()

    const btn = await screen.findByRole('button', { name: /Nova Cobranca/i })
    expect(btn).toBeTruthy()
  })

  it('shows the financial summary cards with correct totals', async () => {
    setup([
      makeEntry({
        id: 'e1',
        status: 'pending',
        totalAmount: '500.00',
        totalFineAmount: 0,
        totalInterestAmount: 0,
        totalAmountPaid: 0,
      }),
      makeEntry({
        id: 'e2',
        status: 'overdue',
        isOverdue: true,
        totalAmount: '300.00',
        totalFineAmount: 10,
        totalInterestAmount: 5,
        totalAmountPaid: 50,
      }),
      makeEntry({
        id: 'e3',
        status: 'paid',
        totalAmount: '200.00',
        totalFineAmount: 0,
        totalInterestAmount: 0,
        totalAmountPaid: 200,
        paidInstallments: 1,
      }),
    ])

    const summary = await screen.findByTestId('financial-summary')
    expect(summary).toBeTruthy()

    // Pending: 500
    const pendingEl = screen.getByTestId('summary-pending')
    expect(pendingEl).toHaveTextContent('500')

    // Overdue: 300 + 10 + 5 - 50 = 265
    const overdueEl = screen.getByTestId('summary-overdue')
    expect(overdueEl).toHaveTextContent('265')

    // Paid: 200
    const paidEl = screen.getByTestId('summary-paid')
    expect(paidEl).toHaveTextContent('200')
  })

  it('shows empty state when no charges exist', async () => {
    setup([])

    const msg = await screen.findByText('Nenhuma cobranca registrada')
    expect(msg).toBeTruthy()
  })

  it('shows count text with correct plural', async () => {
    setup([makeEntry(), makeEntry({ id: 'e2', description: 'Preenchimento labial' })])

    const count = await screen.findByText('2 cobrancas')
    expect(count).toBeTruthy()
  })
})
