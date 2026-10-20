import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { toast } from 'sonner'
import { PartialPaymentDialog } from '../partial-payment-dialog'
import { ApiError } from '@/hooks/mutations/use-financial-mutations'
import { useInstallmentQuote } from '@/hooks/queries/use-installment-quote'
import type { InstallmentQuoteResult } from '@/db/queries/financial-quote'

const mockMutateAsync = vi.fn()
const mockPayState = { isPending: false }

vi.mock('sonner', () => ({
  toast: { error: vi.fn() },
}))

vi.mock('@/hooks/mutations/use-financial-mutations', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/hooks/mutations/use-financial-mutations')>()),
  usePayInstallment: () => ({
    mutateAsync: mockMutateAsync,
    isPending: mockPayState.isPending,
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

vi.mock('@/hooks/queries/use-card-terminals', () => ({
  useCardTerminals: () => ({
    data: {
      data: [
        {
          id: 'term-1',
          name: 'Stone',
          isDefault: true,
          debitRate: '1.50',
          debitPayoutDays: 1,
          creditRates: Array.from({ length: 12 }, () => '4.00'),
          creditPayoutMode: 'per_installment',
          creditLumpSumDays: 1,
        },
      ],
    },
    isLoading: false,
  }),
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
  vi.mocked(toast.error).mockClear()
  mockMutateAsync.mockReset()
  mockMutateAsync.mockResolvedValue({})
  mockPayState.isPending = false
  mockUseInstallmentQuote.mockReset()
  mockQuote()
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
    expect(preview).toHaveTextContent(/Juros\s*R\$\s*10,00/)
    expect(preview).toHaveTextContent(/Multa\s*R\$\s*20,00/)
    expect(preview).toHaveTextContent(/Principal\s*R\$\s*1\.000,00/)
    expect(preview).not.toHaveTextContent('Excedente')
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

  it('warns above quote.totalDue and confirms the overpayment with acceptOverpayment', async () => {
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
        expect.objectContaining({ amount: 1031, acceptOverpayment: true }),
      )
    })
  })

  it('shows no warning at exactly quote.totalDue and does not send acceptOverpayment', async () => {
    render(
      <PartialPaymentDialog open={true} onOpenChange={() => {}} installment={defaultInstallment} />,
      { wrapper: createWrapper() },
    )

    await waitFor(() => {
      expect(screen.getByTestId('partial-payment-amount')).toHaveValue('1.030,00')
    })

    fireEvent.change(screen.getByTestId('partial-payment-amount'), { target: { value: '103000' } })

    expect(screen.queryByText(/Valor acima do total pendente/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar Pagamento' }))

    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalledTimes(1)
    })
    expect(mockMutateAsync.mock.calls[0][0]).toMatchObject({ amount: 1030 })
    expect(mockMutateAsync.mock.calls[0][0].acceptOverpayment).toBeUndefined()
  })

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
    mockQuote({ data: defaultQuote, error: new Error('Falha ao calcular a parcela') })

    render(
      <PartialPaymentDialog open={true} onOpenChange={() => {}} installment={defaultInstallment} />,
      { wrapper: createWrapper() },
    )

    expect(screen.getByText('Falha ao calcular a parcela')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Tentar novamente' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Confirmar Pagamento' })).toBeDisabled()
  })

  it('closes and refreshes the list when the quote says the installment is no longer payable', async () => {
    mockQuote({ data: undefined, error: new ApiError('Parcela cancelada', 'INSTALLMENT_CANCELLED') })
    const onOpenChange = vi.fn()
    const onSuccess = vi.fn()

    render(
      <PartialPaymentDialog open={true} onOpenChange={onOpenChange} onSuccess={onSuccess} installment={defaultInstallment} />,
      { wrapper: createWrapper() },
    )

    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false)
    })
    expect(onSuccess).toHaveBeenCalledTimes(1)
    expect(toast.error).toHaveBeenCalledWith('Parcela cancelada')
  })

  it('shows a backdate refusal next to the date without a retry, and keeps confirm disabled over the previous quote', () => {
    const message =
      'Já existe um pagamento em 18/08/2026 na parcela 2 de Harmonização facial (Maria Silva). Registre pagamentos a partir dessa data.'
    mockQuote({ data: defaultQuote, error: new ApiError(message, 'PAYMENT_BEFORE_LATER_PAYMENT') })

    render(
      <PartialPaymentDialog open={true} onOpenChange={() => {}} installment={defaultInstallment} />,
      { wrapper: createWrapper() },
    )

    expect(screen.getByTestId('partial-payment-date-error')).toHaveTextContent(message)
    expect(screen.queryByRole('button', { name: 'Tentar novamente' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Confirmar Pagamento' })).toBeDisabled()
  })

  it('sends the quoted total with the payment so the server can refuse a stale quote', async () => {
    render(
      <PartialPaymentDialog open={true} onOpenChange={() => {}} installment={defaultInstallment} />,
      { wrapper: createWrapper() },
    )

    await waitFor(() => {
      expect(screen.getByTestId('partial-payment-amount')).toHaveValue('1.030,00')
    })
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar Pagamento' }))

    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({ amount: 1030, expectedTotalDue: 1030 }),
      )
    })
  })

  // Another operator paid first, or BR midnight passed: the server refused the
  // stale quote. The dialog fetches the new price; a prefilled amount follows
  // it, an amount the user typed does not.
  it('refetches the quote and reprefills when the user had not edited the amount', async () => {
    const refetch = vi.fn()
    mockQuote({ refetch })
    mockMutateAsync.mockRejectedValueOnce(
      new ApiError('O total pendente mudou desde que a tela foi aberta.', 'QUOTE_CHANGED'),
    )

    const { rerender } = render(
      <PartialPaymentDialog open={true} onOpenChange={() => {}} installment={defaultInstallment} />,
      { wrapper: createWrapper() },
    )

    await waitFor(() => {
      expect(screen.getByTestId('partial-payment-amount')).toHaveValue('1.030,00')
    })
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar Pagamento' }))

    await waitFor(() => {
      expect(refetch).toHaveBeenCalledTimes(1)
    })
    expect(toast.error).toHaveBeenCalledWith('O total pendente mudou desde que a tela foi aberta.')

    mockQuote({ data: { ...defaultQuote, totalDue: 900 }, refetch })
    rerender(<PartialPaymentDialog open={true} onOpenChange={() => {}} installment={defaultInstallment} />)

    await waitFor(() => {
      expect(screen.getByTestId('partial-payment-amount')).toHaveValue('900,00')
    })
  })

  it('keeps an amount the user typed when the server answers QUOTE_CHANGED', async () => {
    const refetch = vi.fn()
    mockQuote({ refetch })
    mockMutateAsync.mockRejectedValueOnce(
      new ApiError('O total pendente mudou desde que a tela foi aberta.', 'QUOTE_CHANGED'),
    )

    const { rerender } = render(
      <PartialPaymentDialog open={true} onOpenChange={() => {}} installment={defaultInstallment} />,
      { wrapper: createWrapper() },
    )

    await waitFor(() => {
      expect(screen.getByTestId('partial-payment-amount')).toHaveValue('1.030,00')
    })
    fireEvent.change(screen.getByTestId('partial-payment-amount'), { target: { value: '10000' } })
    expect(screen.getByTestId('partial-payment-amount')).toHaveValue('100,00')

    fireEvent.click(screen.getByRole('button', { name: 'Confirmar Pagamento' }))

    await waitFor(() => {
      expect(refetch).toHaveBeenCalledTimes(1)
    })

    mockQuote({ data: { ...defaultQuote, totalDue: 900 }, refetch })
    rerender(<PartialPaymentDialog open={true} onOpenChange={() => {}} installment={defaultInstallment} />)

    // A deliberate R$100 partial payment must not turn into R$900 because
    // someone else paid R$130 in between.
    expect(screen.getByTestId('partial-payment-amount')).toHaveValue('100,00')
  })

  it('closes and refreshes the list when the installment is no longer payable', async () => {
    mockMutateAsync.mockRejectedValueOnce(new ApiError('Parcela já está totalmente paga', 'INSTALLMENT_ALREADY_PAID'))
    const refetch = vi.fn()
    const onOpenChange = vi.fn()
    const onSuccess = vi.fn()
    mockQuote({ refetch })

    render(
      <PartialPaymentDialog open={true} onOpenChange={onOpenChange} onSuccess={onSuccess} installment={defaultInstallment} />,
      { wrapper: createWrapper() },
    )

    await waitFor(() => {
      expect(screen.getByTestId('partial-payment-amount')).toHaveValue('1.030,00')
    })
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar Pagamento' }))

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Parcela já está totalmente paga')
    })
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(onSuccess).toHaveBeenCalledTimes(1)
    expect(refetch).not.toHaveBeenCalled()
  })

  it('does not refetch or close on other errors, it only toasts', async () => {
    const message =
      'Já existe um pagamento em 18/08/2026 na parcela 1 de Harmonização facial (Maria Silva). Registre pagamentos a partir dessa data.'
    mockMutateAsync.mockRejectedValueOnce(new ApiError(message, 'PAYMENT_BEFORE_LATER_PAYMENT'))
    const refetch = vi.fn()
    const onOpenChange = vi.fn()
    mockQuote({ refetch })

    render(
      <PartialPaymentDialog open={true} onOpenChange={onOpenChange} installment={defaultInstallment} />,
      { wrapper: createWrapper() },
    )

    await waitFor(() => {
      expect(screen.getByTestId('partial-payment-amount')).toHaveValue('1.030,00')
    })
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar Pagamento' }))

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(message)
    })
    expect(refetch).not.toHaveBeenCalled()
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  it('disables Cancelar while the payment is in flight', async () => {
    mockPayState.isPending = true
    mockQuote({})

    render(
      <PartialPaymentDialog open={true} onOpenChange={() => {}} installment={defaultInstallment} />,
      { wrapper: createWrapper() },
    )

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Cancelar' })).toBeDisabled()
    })
    expect(screen.getByRole('button', { name: 'Salvando...' })).toBeDisabled()
  })

  it('sends the card with the terminal and parcelas for a credit sale', async () => {
    render(
      <PartialPaymentDialog
        open={true}
        onOpenChange={() => {}}
        installment={defaultInstallment}
        defaultPaymentMethod="credit_card"
        defaultCardInstallmentCount={6}
      />,
      { wrapper: createWrapper() },
    )

    await waitFor(() => {
      expect(screen.getByTestId('partial-payment-amount')).toHaveValue('1.030,00')
    })
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Confirmar Pagamento' })).not.toBeDisabled()
    })
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar Pagamento' }))

    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          paymentMethod: 'credit_card',
          card: { terminalId: 'term-1', installmentCount: 6, expectedRate: 4 },
        }),
      )
    })
  })

  it('sends no card for pix', async () => {
    render(
      <PartialPaymentDialog open={true} onOpenChange={() => {}} installment={defaultInstallment} />,
      { wrapper: createWrapper() },
    )

    await waitFor(() => {
      expect(screen.getByTestId('partial-payment-amount')).toHaveValue('1.030,00')
    })
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar Pagamento' }))

    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalledTimes(1)
    })
    expect(mockMutateAsync.mock.calls[0][0].card).toBeUndefined()
  })

  it('sends a single parcela for a debit sale', async () => {
    render(
      <PartialPaymentDialog
        open={true}
        onOpenChange={() => {}}
        installment={defaultInstallment}
        defaultPaymentMethod="debit_card"
        defaultCardInstallmentCount={6}
      />,
      { wrapper: createWrapper() },
    )

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Confirmar Pagamento' })).not.toBeDisabled()
    })
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar Pagamento' }))

    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({ card: { terminalId: 'term-1', installmentCount: 1, expectedRate: 1.5 } }),
      )
    })
  })

  it('keeps the dialog open and shows the server message when the terminal rate changed', async () => {
    const message = 'A taxa da maquininha mudou desde que a tela foi aberta. Confira o novo valor e confirme novamente.'
    mockMutateAsync.mockRejectedValue(new ApiError(message, 'CARD_RATE_CHANGED'))
    const onOpenChange = vi.fn()
    const onSuccess = vi.fn()
    render(
      <PartialPaymentDialog
        open={true}
        onOpenChange={onOpenChange}
        onSuccess={onSuccess}
        installment={defaultInstallment}
        defaultPaymentMethod="credit_card"
      />,
      { wrapper: createWrapper() },
    )

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Confirmar Pagamento' })).not.toBeDisabled()
    })
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar Pagamento' }))

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(message)
    })
    expect(onOpenChange).not.toHaveBeenCalled()
    expect(onSuccess).not.toHaveBeenCalled()
  })
})
