import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { InstallmentTable } from '../installment-table'

// ─── Mocks ─────────────────────────────────────────────────────────

const mockInstallments = [
  {
    id: 'inst-1',
    installmentNumber: 1,
    amount: '500.00',
    dueDate: '2025-03-01',
    status: 'paid',
    paidAt: new Date('2025-03-01'),
    paymentMethod: 'pix',
    notes: null,
    amountPaid: '500.00',
    fineAmount: '0',
    interestAmount: '0',
    paymentRecords: [],
  },
  {
    id: 'inst-2',
    installmentNumber: 2,
    amount: '500.00',
    dueDate: '2025-04-01',
    status: 'pending',
    paidAt: null,
    paymentMethod: null,
    notes: null,
    amountPaid: '0',
    fineAmount: '0',
    interestAmount: '0',
    paymentRecords: [],
  },
  {
    id: 'inst-3',
    installmentNumber: 3,
    amount: '500.00',
    dueDate: '2025-05-01',
    status: 'overdue',
    paidAt: null,
    paymentMethod: null,
    notes: null,
    amountPaid: '0',
    fineAmount: '10.00',
    interestAmount: '0',
    computedInterestAmount: 5,
    appliedFineValue: '2.00',
    appliedInterestRate: '1.00',
    paymentRecords: [],
  },
]

beforeEach(() => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok: true,
    json: async () => ({ installments: mockInstallments }),
  } as Response)
})

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}))

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    )
  }
}

// ─── Tests ─────────────────────────────────────────────────────────

describe('InstallmentTable', () => {
  it('renders installment rows', async () => {
    render(<InstallmentTable entryId="entry-1" />, { wrapper: createWrapper() })

    // Rows render as "Parcela 1/3", "Parcela 2/3", "Parcela 3/3"
    const row1 = await screen.findByText('Parcela 1/3')
    expect(row1).toBeInTheDocument()
    expect(screen.getByText('Parcela 2/3')).toBeInTheDocument()
    expect(screen.getByText('Parcela 3/3')).toBeInTheDocument()
  })

  it('shows correct status badges', async () => {
    render(<InstallmentTable entryId="entry-1" />, { wrapper: createWrapper() })

    const pago = await screen.findByText('Pago')
    expect(pago).toBeInTheDocument()
    // Both pending and overdue installments render the "Pendente" badge in the current design.
    expect(screen.getAllByText('Pendente').length).toBeGreaterThanOrEqual(2)
  })

  it('shows "Pagar" button for pending and overdue installments', async () => {
    render(<InstallmentTable entryId="entry-1" />, { wrapper: createWrapper() })

    await screen.findByText('Parcela 1/3')
    const payButtons = screen.getAllByTestId('installment-pay')
    // Both pending and overdue installments should have the button
    expect(payButtons).toHaveLength(2)
  })

  it('shows penalty info for overdue installment with penalties', async () => {
    render(<InstallmentTable entryId="entry-1" />, { wrapper: createWrapper() })

    await screen.findByText('Parcela 3/3')
    // The overdue installment (inst-3) has fineAmount=10, rendered as a "Multa R$..." span.
    // It's not wrapped in a PenaltyBadge testid here; look up the text content.
    const multa = screen.getByText(/^Multa\s*R\$/)
    expect(multa).toBeInTheDocument()
  })

  it('shows the computed penalty, never the raw interestAmount fallback', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        installments: [
          {
            id: 'inst-1',
            installmentNumber: 1,
            amount: '1000',
            dueDate: '2026-08-25',
            status: 'pending',
            paidAt: null,
            paymentMethod: null,
            notes: null,
            amountPaid: '0',
            fineAmount: '0',
            interestAmount: '99.99',
            computedFineAmount: 20,
            computedInterestAmount: 1.67,
            appliedFineValue: '2.00',
            appliedInterestRate: '1',
            lastFineInterestCalcAt: null,
            paymentRecords: [],
          },
        ],
      }),
    } as Response)

    render(<InstallmentTable entryId="entry-1" />, { wrapper: createWrapper() })

    await screen.findByText('Parcela 1/1')
    // fineAmt 20 + interestAmt 1.67 = 21.67, split across two spans.
    expect(screen.getByText(/^Multa\s*R\$\s*20,00/)).toBeInTheDocument()
    expect(screen.getByText(/^Juros\s*R\$\s*1,67/)).toBeInTheDocument()
    expect(screen.queryByText(/99,99/)).not.toBeInTheDocument()
  })

  it('shows the excess when a payment record covers more than the installment owed', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        installments: [
          {
            id: 'inst-1',
            installmentNumber: 1,
            amount: '791.00',
            dueDate: '2026-08-25',
            status: 'paid',
            paidAt: '2026-09-01T15:00:00.000Z',
            paymentMethod: 'pix',
            notes: null,
            amountPaid: '791.00',
            fineAmount: '15.00',
            interestAmount: '26.00',
            paymentRecords: [
              {
                id: 'pay-1',
                amount: '800.00',
                paymentMethod: 'pix',
                interestCovered: '26.00',
                fineCovered: '15.00',
                principalCovered: '750.00',
                paidAt: '2026-09-01T12:00:00.000Z',
                recordedAt: '2026-09-01T12:00:00.000Z',
                notes: null,
              },
            ],
          },
        ],
      }),
    } as Response)

    render(<InstallmentTable entryId="entry-1" />, { wrapper: createWrapper() })

    await screen.findByText('Parcela 1/1')
    fireEvent.click(screen.getByTestId('installment-expand-payments'))

    expect(await screen.findByText('Excedente R$ 9,00')).toBeInTheDocument()
  })

  it('shows no excess label when the covered columns sum to the payment amount', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        installments: [
          {
            id: 'inst-1',
            installmentNumber: 1,
            amount: '750.00',
            dueDate: '2026-08-25',
            status: 'paid',
            paidAt: '2026-09-01T15:00:00.000Z',
            paymentMethod: 'pix',
            notes: null,
            amountPaid: '750.00',
            fineAmount: '0',
            interestAmount: '0',
            paymentRecords: [
              {
                id: 'pay-1',
                amount: '750.00',
                paymentMethod: 'pix',
                interestCovered: '0',
                fineCovered: '0',
                principalCovered: '750.00',
                paidAt: '2026-09-01T12:00:00.000Z',
                recordedAt: '2026-09-01T12:00:00.000Z',
                notes: null,
              },
            ],
          },
        ],
      }),
    } as Response)

    render(<InstallmentTable entryId="entry-1" />, { wrapper: createWrapper() })

    await screen.findByText('Parcela 1/1')
    fireEvent.click(screen.getByTestId('installment-expand-payments'))

    await screen.findByText(/^Principal\s*R\$/)
    expect(screen.queryByText(/Excedente/)).not.toBeInTheDocument()
  })
})
