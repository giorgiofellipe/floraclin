import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ExpenseEditDialog } from '../expense-edit-dialog'

const mockMutateAsync = vi.fn()

vi.mock('@/hooks/mutations/use-expense-mutations', () => ({
  useUpdateExpense: vi.fn().mockReturnValue({
    mutateAsync: (...args: unknown[]) => mockMutateAsync(...args),
    isPending: false,
  }),
}))

vi.mock('@/hooks/queries/use-financial-settings', () => ({
  useExpenseCategories: vi.fn().mockReturnValue({
    data: { data: [{ id: 'cat-1', name: 'Aluguel', icon: 'home' }] },
  }),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>
}

const expense = {
  id: 'exp-1',
  description: 'Aluguel',
  categoryId: 'cat-1',
  notes: null,
  totalAmount: '1000.00',
  installmentCount: 5,
  status: 'pending',
  installments: [
    { id: 'i1', installmentNumber: 1, amount: '200.00', dueDate: '2026-01-01', status: 'paid', paidAt: '2026-01-01T12:00:00Z', paymentMethod: 'pix' },
    { id: 'i2', installmentNumber: 2, amount: '200.00', dueDate: '2026-02-01', status: 'paid', paidAt: '2026-02-01T12:00:00Z', paymentMethod: 'pix' },
    { id: 'i3', installmentNumber: 3, amount: '200.00', dueDate: '2026-03-01', status: 'pending', paidAt: null, paymentMethod: null },
    { id: 'i4', installmentNumber: 4, amount: '200.00', dueDate: '2026-04-01', status: 'pending', paidAt: null, paymentMethod: null },
    { id: 'i5', installmentNumber: 5, amount: '200.00', dueDate: '2026-05-01', status: 'pending', paidAt: null, paymentMethod: null },
  ],
}

describe('ExpenseEditDialog', () => {
  const baseProps = {
    open: true,
    onOpenChange: vi.fn(),
    expense,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockMutateAsync.mockResolvedValue({ success: true })
  })

  it('renders title and key fields', () => {
    render(wrap(<ExpenseEditDialog {...baseProps} />))
    expect(screen.getByText('Editar despesa')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Aluguel')).toBeInTheDocument()
  })

  it('shows paid installments as locked with counts', () => {
    render(wrap(<ExpenseEditDialog {...baseProps} />))
    expect(screen.getByText(/2 parcelas pagas/)).toBeInTheDocument()
  })
})
