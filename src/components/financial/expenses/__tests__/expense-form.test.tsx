import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ExpenseForm } from '../expense-form'

// ─── Mocks ─────────────────────────────────────────────────────────

vi.mock('@/hooks/queries/use-financial-settings', () => ({
  useExpenseCategories: vi.fn().mockReturnValue({
    data: [
      { id: 'cat-1', name: 'Aluguel', icon: 'home' },
      { id: 'cat-2', name: 'Material', icon: 'package' },
    ],
  }),
  useFinancialSettings: vi.fn().mockReturnValue({ data: null }),
}))

vi.mock('@/hooks/mutations/use-expense-mutations', () => ({
  useCreateExpense: vi.fn().mockReturnValue({
    mutateAsync: vi.fn().mockResolvedValue({ id: 'new-expense' }),
    isPending: false,
  }),
}))

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
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

// ─── Tests ─────────────────────────────────────────────────────────

describe('ExpenseForm', () => {
  const defaultProps = {
    open: true,
    onClose: vi.fn(),
    onSuccess: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the form with all fields', () => {
    render(<ExpenseForm {...defaultProps} />, { wrapper: createWrapper() })

    expect(screen.getByText('Nova Despesa')).toBeInTheDocument()
    expect(screen.getByTestId('expense-category-select')).toBeInTheDocument()
    expect(screen.getByTestId('expense-description')).toBeInTheDocument()
    expect(screen.getByTestId('expense-amount')).toBeInTheDocument()
    expect(screen.getByTestId('expense-installment-count')).toBeInTheDocument()
    expect(screen.getByTestId('expense-notes')).toBeInTheDocument()
    expect(screen.getByTestId('expense-form-submit')).toBeInTheDocument()
  })

  it('shows installment preview when amount is entered', async () => {
    render(<ExpenseForm {...defaultProps} />, { wrapper: createWrapper() })

    const amountInput = screen.getByTestId('expense-amount')
    await userEvent.type(amountInput, '100000')

    await waitFor(() => {
      expect(screen.getByTestId('installment-preview')).toBeInTheDocument()
    })
  })

  it('shows submit button with correct text', () => {
    render(<ExpenseForm {...defaultProps} />, { wrapper: createWrapper() })

    expect(screen.getByTestId('expense-form-submit')).toHaveTextContent('Criar Despesa')
  })

  it('shows cancel button', () => {
    render(<ExpenseForm {...defaultProps} />, { wrapper: createWrapper() })

    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeInTheDocument()
  })

  it('renders custom due dates toggle', () => {
    render(<ExpenseForm {...defaultProps} />, { wrapper: createWrapper() })

    expect(screen.getByText('Definir datas de vencimento manualmente')).toBeInTheDocument()
  })
})
