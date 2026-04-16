import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ExpenseList } from '../expense-list'

// ─── Mocks ─────────────────────────────────────────────────────────

vi.mock('@/hooks/queries/use-expenses', () => ({
  useExpenses: vi.fn().mockReturnValue({
    data: {
      data: [
        {
          id: 'exp-1',
          categoryId: 'cat-1',
          categoryName: 'Aluguel',
          categoryIcon: 'home',
          description: 'Aluguel do consultorio',
          totalAmount: '3000.00',
          installmentCount: 3,
          paidInstallments: 1,
          status: 'pending',
          isOverdue: false,
          createdAt: '2025-06-01',
        },
        {
          id: 'exp-2',
          categoryId: 'cat-2',
          categoryName: 'Material',
          categoryIcon: 'package',
          description: 'Seringas descartaveis',
          totalAmount: '500.00',
          installmentCount: 1,
          paidInstallments: 1,
          status: 'paid',
          isOverdue: false,
          createdAt: '2025-05-15',
        },
      ],
      total: 2,
      page: 1,
      limit: 20,
      totalPages: 1,
    },
    isPending: false,
  }),
  useExpenseDetail: vi.fn().mockReturnValue({ data: null, isLoading: false }),
}))

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
  useCreateExpense: vi.fn().mockReturnValue({ mutateAsync: vi.fn(), isPending: false }),
  usePayExpenseInstallment: vi.fn().mockReturnValue({ mutateAsync: vi.fn(), isPending: false }),
  useCancelExpense: vi.fn().mockReturnValue({ mutateAsync: vi.fn(), isPending: false }),
  useUploadExpenseAttachment: vi.fn().mockReturnValue({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteExpenseAttachment: vi.fn().mockReturnValue({ mutateAsync: vi.fn(), isPending: false }),
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

describe('ExpenseList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders expense rows', () => {
    render(<ExpenseList />, { wrapper: createWrapper() })

    expect(screen.getByText('Aluguel do consultorio')).toBeInTheDocument()
    expect(screen.getByText('Seringas descartaveis')).toBeInTheDocument()
  })

  it('shows category names', () => {
    render(<ExpenseList />, { wrapper: createWrapper() })

    expect(screen.getByText('Aluguel')).toBeInTheDocument()
    expect(screen.getByText('Material')).toBeInTheDocument()
  })

  it('shows paid installment counts', () => {
    render(<ExpenseList />, { wrapper: createWrapper() })

    expect(screen.getByText('1/3')).toBeInTheDocument()
    expect(screen.getByText('1/1')).toBeInTheDocument()
  })

  it('shows status badges', () => {
    render(<ExpenseList />, { wrapper: createWrapper() })

    expect(screen.getByText('Pendente')).toBeInTheDocument()
    expect(screen.getByText('Pago')).toBeInTheDocument()
  })

  it('renders filter toggle button', () => {
    render(<ExpenseList />, { wrapper: createWrapper() })

    // The filter panel is collapsed by default and opened by clicking the toggle.
    expect(screen.getByTestId('expense-filters-toggle')).toBeInTheDocument()
  })

  it('renders Nova Despesa button', () => {
    render(<ExpenseList />, { wrapper: createWrapper() })

    expect(screen.getByTestId('new-expense-button')).toBeInTheDocument()
    expect(screen.getByText('Nova Despesa')).toBeInTheDocument()
  })

  it('shows total count', () => {
    render(<ExpenseList />, { wrapper: createWrapper() })

    expect(screen.getByText('2 despesas')).toBeInTheDocument()
  })
})
