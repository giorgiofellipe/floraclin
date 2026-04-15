import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
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

    const row1 = await screen.findByText('1/3')
    expect(row1).toBeInTheDocument()
    expect(screen.getByText('2/3')).toBeInTheDocument()
    expect(screen.getByText('3/3')).toBeInTheDocument()
  })

  it('shows correct status badges', async () => {
    render(<InstallmentTable entryId="entry-1" />, { wrapper: createWrapper() })

    const pago = await screen.findByText('Pago')
    expect(pago).toBeInTheDocument()
    expect(screen.getByText('Pendente')).toBeInTheDocument()
    expect(screen.getByText('Atrasado')).toBeInTheDocument()
  })

  it('shows "Registrar Pagamento" button for pending and overdue installments', async () => {
    render(<InstallmentTable entryId="entry-1" />, { wrapper: createWrapper() })

    await screen.findByText('1/3')
    const payButtons = screen.getAllByRole('button', { name: /registrar pagamento/i })
    // Both pending and overdue installments should have the button
    expect(payButtons).toHaveLength(2)
  })

  it('shows penalty badge for overdue installment with penalties', async () => {
    render(<InstallmentTable entryId="entry-1" />, { wrapper: createWrapper() })

    await screen.findByText('1/3')
    // The overdue installment has fineAmount=10 and computedInterestAmount=5
    const penaltyBadges = screen.getAllByTestId('penalty-badge')
    expect(penaltyBadges.length).toBeGreaterThan(0)
    const overdueBadge = penaltyBadges.find((b) => b.textContent?.includes('Multa'))
    expect(overdueBadge).toBeDefined()
  })
})
