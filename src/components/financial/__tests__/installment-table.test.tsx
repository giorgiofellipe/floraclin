import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { InstallmentTable } from '../installment-table'

// ─── Mocks ─────────────────────────────────────────────────────────

vi.mock('@/actions/financial', () => ({
  getFinancialEntryAction: vi.fn().mockResolvedValue({
    data: {
      installments: [
        {
          id: 'inst-1',
          installmentNumber: 1,
          amount: '500.00',
          dueDate: '2025-03-01',
          status: 'paid',
          paidAt: new Date('2025-03-01'),
          paymentMethod: 'pix',
          notes: null,
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
        },
      ],
    },
  }),
  payInstallmentAction: vi.fn().mockResolvedValue({ success: true }),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}))

// ─── Tests ─────────────────────────────────────────────────────────

describe('InstallmentTable', () => {
  it('renders installment rows', async () => {
    render(<InstallmentTable entryId="entry-1" />)

    // Wait for loading to finish
    const row1 = await screen.findByText('1/3')
    expect(row1).toBeInTheDocument()
    expect(screen.getByText('2/3')).toBeInTheDocument()
    expect(screen.getByText('3/3')).toBeInTheDocument()
  })

  it('shows correct status badges', async () => {
    render(<InstallmentTable entryId="entry-1" />)

    const pago = await screen.findByText('Pago')
    expect(pago).toBeInTheDocument()
    expect(screen.getByText('Pendente')).toBeInTheDocument()
    expect(screen.getByText('Atrasado')).toBeInTheDocument()
  })

  it('shows "Marcar como pago" button for pending installments', async () => {
    render(<InstallmentTable entryId="entry-1" />)

    const payButton = await screen.findByRole('button', { name: /marcar como pago/i })
    expect(payButton).toBeInTheDocument()

    // Should have exactly 1 "Marcar como pago" button (only for 'pending', not 'overdue')
    const allPayButtons = screen.getAllByRole('button', { name: /marcar como pago/i })
    expect(allPayButtons).toHaveLength(1)
  })
})
