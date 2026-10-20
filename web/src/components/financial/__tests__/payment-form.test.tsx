import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { toast } from 'sonner'
import { PaymentForm } from '../payment-form'

const mockCreate = vi.fn()

vi.mock('sonner', () => ({ toast: { error: vi.fn(), warning: vi.fn() } }))

vi.mock('@/hooks/mutations/use-financial-mutations', () => ({
  useCreateFinancialEntry: () => ({ mutateAsync: mockCreate, isPending: false }),
}))

vi.mock('@/hooks/queries/use-financial-settings', () => ({
  useFinancialSettings: () => ({ data: { settings: { defaultInstallmentCount: 3 } } }),
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

vi.mock('@/components/ui/date-picker', () => ({
  DatePicker: () => null,
}))

// The method select is a popover; a native select lets the test pick a method.
vi.mock('@/components/ui/select', () => ({
  Select: ({
    value,
    onValueChange,
    items,
    disabled,
  }: {
    value: string
    onValueChange: (v: string) => void
    items: Record<string, string>
    disabled?: boolean
  }) => (
    <select
      data-testid={`select-${Object.keys(items ?? {})[0]}`}
      value={value}
      disabled={disabled}
      onChange={(e) => onValueChange(e.target.value)}
    >
      {Object.entries(items ?? {}).map(([k, label]) => (
        <option key={k} value={k}>
          {label}
        </option>
      ))}
    </select>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: () => null,
}))

function renderForm(onSuccess = vi.fn()) {
  render(
    <PaymentForm
      open
      onClose={() => {}}
      onSuccess={onSuccess}
      defaultPatient={{ id: 'pat-1', fullName: 'Maria' }}
    />,
  )
  fireEvent.change(screen.getByPlaceholderText('Ex: Aplicação de toxina botulínica'), {
    target: { value: 'Harmonização' },
  })
  fireEvent.change(screen.getByTestId('payment-form-amount'), { target: { value: '300000' } })
  return onSuccess
}

// pix is the first item of the method select; '1' the first of parcelas
const methodSelect = () => screen.getByTestId('select-pix')
const parcelasSelect = () => screen.getAllByTestId('select-1')[0]

beforeEach(() => {
  vi.clearAllMocks()
  mockCreate.mockResolvedValue({ success: true })
})

describe('PaymentForm card methods', () => {
  it('turns the chosen parcelas into card parcelas for credit and sends one patient installment', async () => {
    renderForm()
    expect(parcelasSelect()).toHaveValue('3')

    fireEvent.change(methodSelect(), { target: { value: 'credit_card' } })

    // Only "Parcelas no cartão" is left, carrying the 3x the user had picked.
    await waitFor(() => expect(screen.getByText('Parcelas no cartão')).toBeInTheDocument())
    expect(screen.queryByText('Parcelas')).toBeNull()
    expect(screen.queryByText('Parcelas e vencimentos')).toBeNull()
    expect(screen.getAllByTestId('select-1')).toHaveLength(1)
    expect(parcelasSelect()).toHaveValue('3')

    await waitFor(() => expect(screen.getByTestId('payment-form-submit')).not.toBeDisabled())
    fireEvent.click(screen.getByTestId('payment-form-submit'))

    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1))
    expect(mockCreate.mock.calls[0][0]).toMatchObject({
      installmentCount: 1,
      paymentMethod: 'credit_card',
      card: { terminalId: 'term-1', installmentCount: 3 },
    })
  })

  it('sends paymentMethod without card for pix', async () => {
    renderForm()
    fireEvent.click(screen.getByTestId('payment-form-submit'))

    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1))
    expect(mockCreate.mock.calls[0][0]).toMatchObject({ installmentCount: 3, paymentMethod: 'pix' })
    expect(mockCreate.mock.calls[0][0].card).toBeUndefined()
  })

  it('tells the user the charge stays pending when the card payment failed', async () => {
    mockCreate.mockResolvedValue({ success: true, paymentError: 'Maquininha inativa' })
    const onSuccess = renderForm()
    fireEvent.change(methodSelect(), { target: { value: 'debit_card' } })
    await waitFor(() => expect(screen.getByTestId('payment-form-submit')).not.toBeDisabled())
    fireEvent.click(screen.getByTestId('payment-form-submit'))

    await waitFor(() => expect(onSuccess).toHaveBeenCalled())
    expect(toast.error).toHaveBeenCalledWith('Maquininha inativa', {
      description: 'A cobrança foi criada como pendente.',
    })
  })
})
