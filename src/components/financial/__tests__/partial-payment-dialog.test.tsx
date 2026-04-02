import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { PartialPaymentDialog } from '../partial-payment-dialog'

// Mock mutations
vi.mock('@/hooks/mutations/use-financial-mutations', () => ({
  usePayInstallment: () => ({
    mutateAsync: vi.fn().mockResolvedValue({}),
    isPending: false,
  }),
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

describe('PartialPaymentDialog', () => {
  const defaultInstallment = {
    id: 'inst-1',
    amount: 1000,
    amountPaid: 0,
    fineAmount: 20,
    interestAmount: 10,
  }

  it('renders with total due displayed', () => {
    render(
      <PartialPaymentDialog
        open={true}
        onOpenChange={() => {}}
        installment={defaultInstallment}
      />,
      { wrapper: createWrapper() },
    )

    // Should show the dialog title
    expect(screen.getByText('Registrar Pagamento')).toBeInTheDocument()
  })

  it('shows Art. 354 allocation preview with correct breakdown', () => {
    render(
      <PartialPaymentDialog
        open={true}
        onOpenChange={() => {}}
        installment={defaultInstallment}
      />,
      { wrapper: createWrapper() },
    )

    // The dialog pre-fills amount with total due (1000 + 20 + 10 = 1030)
    // Allocation preview should show:
    const preview = screen.getByTestId('allocation-preview')
    expect(preview).toBeInTheDocument()
    expect(preview).toHaveTextContent('Juros')
    expect(preview).toHaveTextContent('Multa')
    expect(preview).toHaveTextContent('Principal')
  })

  it('shows Art. 354 label', () => {
    render(
      <PartialPaymentDialog
        open={true}
        onOpenChange={() => {}}
        installment={defaultInstallment}
      />,
      { wrapper: createWrapper() },
    )

    expect(screen.getByText(/Art\. 354/)).toBeInTheDocument()
  })
})
