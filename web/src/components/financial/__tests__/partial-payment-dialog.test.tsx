import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { PartialPaymentDialog } from '../partial-payment-dialog'
import { useInstallmentQuote } from '@/hooks/queries/use-installment-quote'
import type { InstallmentQuoteResult } from '@/db/queries/financial-quote'

const mockMutateAsync = vi.fn()

vi.mock('@/hooks/mutations/use-financial-mutations', () => ({
  usePayInstallment: () => ({
    mutateAsync: mockMutateAsync,
    isPending: false,
  }),
}))

vi.mock('@/hooks/queries/use-installment-quote', () => ({
  useInstallmentQuote: vi.fn(),
}))

// The real DatePicker drives a calendar popover; a plain input is enough to
// exercise the dialog's own logic (it only cares about the YYYY-MM-DD value).
vi.mock('@/components/ui/date-picker', () => ({
  DatePicker: ({ value, onChange }: { value?: string; onChange?: (v: string) => void }) => (
    <input
      data-testid="partial-payment-date"
      value={value ?? ''}
      onChange={(e) => onChange?.(e.target.value)}
    />
  ),
}))

const mockUseInstallmentQuote = vi.mocked(useInstallmentQuote)

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

const defaultInstallment = { id: 'inst-1', amount: 1030 }

const defaultQuote: InstallmentQuoteResult = {
  remainingPrincipal: 1000,
  fineAmount: 20,
  interestAmount: 10,
  totalDue: 1030,
  asOf: '2026-08-20T12:00:00.000Z',
}

function mockQuote(overrides: Partial<ReturnType<typeof useInstallmentQuote>> = {}) {
  mockUseInstallmentQuote.mockReturnValue({
    data: defaultQuote,
    isFetching: false,
    error: null,
    refetch: vi.fn(),
    ...overrides,
  } as ReturnType<typeof useInstallmentQuote>)
}

beforeEach(() => {
  mockMutateAsync.mockReset()
  mockMutateAsync.mockResolvedValue({})
  mockUseInstallmentQuote.mockReset()
  mockQuote()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('PartialPaymentDialog', () => {
  it('prefills the amount from quote.totalDue', async () => {
    render(
      <PartialPaymentDialog open={true} onOpenChange={() => {}} installment={defaultInstallment} />,
      { wrapper: createWrapper() },
    )

    await waitFor(() => {
      expect(screen.getByTestId('partial-payment-amount')).toHaveValue('1.030,00')
    })
  })

  it('renders the breakdown from the quote, not from any prop', async () => {
    render(
      <PartialPaymentDialog open={true} onOpenChange={() => {}} installment={defaultInstallment} />,
      { wrapper: createWrapper() },
    )

    expect(screen.getByText(/Total pendente: R\$\s*1\.030,00/)).toBeInTheDocument()
    expect(screen.getByText(/Principal R\$\s*1\.000,00/)).toBeInTheDocument()
    expect(screen.getByText(/Multa R\$\s*20,00/)).toBeInTheDocument()
    expect(screen.getByText(/Juros R\$\s*10,00/)).toBeInTheDocument()
  })

  it('shows Art. 354 allocation preview with correct breakdown', async () => {
    render(
      <PartialPaymentDialog open={true} onOpenChange={() => {}} installment={defaultInstallment} />,
      { wrapper: createWrapper() },
    )

    await waitFor(() => {
      expect(screen.getByTestId('partial-payment-amount')).toHaveValue('1.030,00')
    })

    const preview = screen.getByTestId('allocation-preview')
    expect(preview).toBeInTheDocument()
    expect(preview).toHaveTextContent('Juros')
    expect(preview).toHaveTextContent('Multa')
    expect(preview).toHaveTextContent('Principal')
  })

  it('picking today sends undefined as paidAt, to both the hook and the mutation', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-08-20T15:00:00Z')) // BR noon on 2026-08-20

    render(
      <PartialPaymentDialog open={true} onOpenChange={() => {}} installment={defaultInstallment} />,
      { wrapper: createWrapper() },
    )

    fireEvent.change(screen.getByTestId('partial-payment-date'), { target: { value: '2026-08-20' } })

    await waitFor(() => {
      const lastCall = mockUseInstallmentQuote.mock.calls.at(-1)
      expect(lastCall?.[1]).toBeUndefined()
    })

    await waitFor(() => {
      expect(screen.getByTestId('partial-payment-amount')).toHaveValue('1.030,00')
    })
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar Pagamento' }))

    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({ paidAt: undefined }),
      )
    })
  })

  it('picking a past date sends BR noon of that day, never UTC midnight', async () => {
    render(
      <PartialPaymentDialog open={true} onOpenChange={() => {}} installment={defaultInstallment} />,
      { wrapper: createWrapper() },
    )

    fireEvent.change(screen.getByTestId('partial-payment-date'), { target: { value: '2026-08-15' } })

    await waitFor(() => {
      const lastCall = mockUseInstallmentQuote.mock.calls.at(-1)
      expect(lastCall?.[1]).toBe('2026-08-15T15:00:00.000Z')
    })

    await waitFor(() => {
      expect(screen.getByTestId('partial-payment-amount')).toHaveValue('1.030,00')
    })
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar Pagamento' }))

    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({ paidAt: '2026-08-15T15:00:00.000Z' }),
      )
    })
  })

  it('allows confirm at exactly quote.totalDue', async () => {
    render(
      <PartialPaymentDialog open={true} onOpenChange={() => {}} installment={defaultInstallment} />,
      { wrapper: createWrapper() },
    )

    await waitFor(() => {
      expect(screen.getByTestId('partial-payment-amount')).toHaveValue('1.030,00')
    })

    fireEvent.change(screen.getByTestId('partial-payment-amount'), { target: { value: '103000' } })

    expect(screen.getByRole('button', { name: 'Confirmar Pagamento' })).not.toBeDisabled()
  })

  it('warns above quote.totalDue and keeps confirm enabled', async () => {
    render(
      <PartialPaymentDialog open={true} onOpenChange={() => {}} installment={defaultInstallment} />,
      { wrapper: createWrapper() },
    )

    await waitFor(() => {
      expect(screen.getByTestId('partial-payment-amount')).toHaveValue('1.030,00')
    })

    fireEvent.change(screen.getByTestId('partial-payment-amount'), { target: { value: '103100' } })

    expect(screen.getByText(/Valor acima do total pendente/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Confirmar Pagamento' })).not.toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: 'Confirmar Pagamento' }))

    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({ amount: 1031 }),
      )
    })
  })

  it('shows no warning at exactly quote.totalDue', async () => {
    render(
      <PartialPaymentDialog open={true} onOpenChange={() => {}} installment={defaultInstallment} />,
      { wrapper: createWrapper() },
    )

    await waitFor(() => {
      expect(screen.getByTestId('partial-payment-amount')).toHaveValue('1.030,00')
    })

    fireEvent.change(screen.getByTestId('partial-payment-amount'), { target: { value: '103000' } })

    expect(screen.queryByText(/Valor acima do total pendente/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Confirmar Pagamento' })).not.toBeDisabled()
  })

  it('does not overwrite an amount the user edited when the quote refetches', async () => {
    const { rerender } = render(
      <PartialPaymentDialog open={true} onOpenChange={() => {}} installment={defaultInstallment} />,
      { wrapper: createWrapper() },
    )

    await waitFor(() => {
      expect(screen.getByTestId('partial-payment-amount')).toHaveValue('1.030,00')
    })

    fireEvent.change(screen.getByTestId('partial-payment-amount'), { target: { value: '105000' } })
    expect(screen.getByTestId('partial-payment-amount')).toHaveValue('1.050,00')

    mockQuote({ data: { ...defaultQuote, totalDue: 2000 } })
    rerender(<PartialPaymentDialog open={true} onOpenChange={() => {}} installment={defaultInstallment} />)

    expect(screen.getByTestId('partial-payment-amount')).toHaveValue('1.050,00')
  })

  // The edit flag protects a user's amount within one quote. Carrying it across
  // a date change would submit a figure priced for the previous day, which is
  // the class of bug this dialog exists to fix.
  it('reprefills from the new quote when the user changes the date after editing the amount', async () => {
    const { rerender } = render(
      <PartialPaymentDialog open={true} onOpenChange={() => {}} installment={defaultInstallment} />,
      { wrapper: createWrapper() },
    )

    await waitFor(() => {
      expect(screen.getByTestId('partial-payment-amount')).toHaveValue('1.030,00')
    })

    fireEvent.change(screen.getByTestId('partial-payment-amount'), { target: { value: '105000' } })
    expect(screen.getByTestId('partial-payment-amount')).toHaveValue('1.050,00')

    fireEvent.change(screen.getByTestId('partial-payment-date'), {
      target: { value: '2026-08-15' },
    })
    mockQuote({ data: { ...defaultQuote, totalDue: 900 } })
    rerender(<PartialPaymentDialog open={true} onOpenChange={() => {}} installment={defaultInstallment} />)

    await waitFor(() => {
      expect(screen.getByTestId('partial-payment-amount')).toHaveValue('900,00')
    })
  })

  // A cached quote for the previous date must not stay on screen while the
  // quote for the newly picked date is still in flight.
  it('hides a stale total while a new quote is being fetched', () => {
    mockQuote({ data: defaultQuote, isFetching: true })

    render(
      <PartialPaymentDialog open={true} onOpenChange={() => {}} installment={defaultInstallment} />,
      { wrapper: createWrapper() },
    )

    expect(screen.getByText('Calculando...')).toBeInTheDocument()
    expect(screen.queryByText(/Total pendente:/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Confirmar Pagamento' })).toBeDisabled()
  })

  it('shows the error and disables confirm when the hook returns an error', () => {
    mockQuote({ data: undefined, error: new Error('Falha ao calcular a parcela') })

    render(
      <PartialPaymentDialog open={true} onOpenChange={() => {}} installment={defaultInstallment} />,
      { wrapper: createWrapper() },
    )

    expect(screen.getByText('Falha ao calcular a parcela')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Confirmar Pagamento' })).toBeDisabled()
  })
})
