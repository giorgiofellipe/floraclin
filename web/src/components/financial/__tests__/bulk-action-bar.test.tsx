import { afterEach, describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent, { PointerEventsCheckLevel } from '@testing-library/user-event'
import { BulkActionBar } from '../bulk-action-bar'
import { useInstallmentQuote } from '@/hooks/queries/use-installment-quote'
import { createWrapper } from '@/tests/test-utils'

const access = vi.hoisted(() => ({ role: 'owner' }))
vi.mock('@/components/layout/subscription-access', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/components/layout/subscription-access')>()),
  useSubscriptionAccess: () => ({ role: access.role, readOnly: false }),
}))

vi.mock('@/hooks/queries/use-installment-quote', () => ({
  useInstallmentQuote: vi.fn(),
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

// The bar's method select is a popover; mocking it to a native select drives the choice.
vi.mock('@/components/ui/select', () => ({
  Select: ({
    value,
    onValueChange,
    items,
  }: {
    value: string
    onValueChange: (v: string) => void
    items: Record<string, string>
  }) => (
    <select data-testid="method-select" value={value} onChange={(e) => onValueChange(e.target.value)}>
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

const mockBulkPay = vi.fn().mockResolvedValue({})
const mockBulkCancel = vi.fn().mockResolvedValue({})
const mockBulkUncancel = vi.fn().mockResolvedValue({})

// Mock mutations
vi.mock('@/hooks/mutations/use-financial-mutations', () => ({
  useBulkPay: () => ({
    mutateAsync: mockBulkPay,
    isPending: false,
  }),
  useBulkCancel: () => ({
    mutateAsync: mockBulkCancel,
    isPending: false,
  }),
  useBulkUncancel: () => ({
    mutateAsync: mockBulkUncancel,
    isPending: false,
  }),
}))

// The real DatePicker drives a calendar popover; a plain input is enough to
// exercise the bar's own logic (it only cares about the YYYY-MM-DD value).
vi.mock('@/components/ui/date-picker', () => ({
  DatePicker: ({ value, onChange }: { value?: string; onChange?: (v: string) => void }) => (
    <input
      data-testid="bulk-pay-date"
      value={value ?? ''}
      onChange={(e) => onChange?.(e.target.value)}
    />
  ),
}))

afterEach(() => {
  access.role = 'owner'
  mockBulkPay.mockClear()
  mockBulkCancel.mockClear()
  mockBulkUncancel.mockClear()
})

describe('BulkActionBar', () => {
  it('renders nothing when no items selected', () => {
    const { container } = render(
      <BulkActionBar
        selectedCount={0}
        selectedInstallmentIds={[]}
        selectedEntryIds={[]}
        onClear={() => {}}
        onRenegotiate={() => {}}
      />,
      { wrapper: createWrapper() },
    )
    expect(screen.queryByTestId('bulk-action-bar')).not.toBeInTheDocument()
  })

  it('shows bar with count when items selected', () => {
    render(
      <BulkActionBar
        selectedCount={3}
        selectedInstallmentIds={['a', 'b', 'c']}
        selectedEntryIds={['e1', 'e2', 'e3']}
        onClear={() => {}}
        onRenegotiate={() => {}}
      />,
      { wrapper: createWrapper() },
    )
    const bar = screen.getByTestId('bulk-action-bar')
    expect(bar).toBeInTheDocument()
    expect(bar).toHaveTextContent('3 selecionados')
  })

  it('shows action buttons with correct counts', () => {
    render(
      <BulkActionBar
        selectedCount={2}
        selectedInstallmentIds={['a', 'b']}
        selectedEntryIds={['e1', 'e2']}
        onClear={() => {}}
        onRenegotiate={() => {}}
      />,
      { wrapper: createWrapper() },
    )
    expect(screen.getByText(/Receber \(2\)/)).toBeInTheDocument()
    expect(screen.getByText(/Cancelar \(2\)/)).toBeInTheDocument()
    expect(screen.getByText(/Renegociar \(2\)/)).toBeInTheDocument()
  })

  it('gives a receptionist only Receber, since cancel and renegotiate answer 403 for that role', () => {
    access.role = 'receptionist'
    render(
      <BulkActionBar
        selectedCount={2}
        selectedInstallmentIds={['a', 'b']}
        selectedEntryIds={['e1', 'e2']}
        canUncancel={true}
        onClear={() => {}}
        onRenegotiate={() => {}}
      />,
      { wrapper: createWrapper() },
    )
    expect(screen.getByText(/Receber \(2\)/)).toBeInTheDocument()
    expect(screen.queryByText(/Cancelar|Renegociar|Reativar/)).not.toBeInTheDocument()
    expect(screen.queryByTestId('bulk-more')).not.toBeInTheDocument()
  })

  it('holds Cancelar, Renegociar and Reativar behind "Mais" for phones, with the reason a disabled one is off', async () => {
    const onRenegotiate = vi.fn()
    render(
      <BulkActionBar
        selectedCount={2}
        selectedInstallmentIds={[]}
        selectedEntryIds={['e1', 'e2']}
        canRenegotiate={false}
        canUncancel={true}
        onClear={() => {}}
        onRenegotiate={onRenegotiate}
      />,
      { wrapper: createWrapper() },
    )

    const user = userEvent.setup({ pointerEventsCheck: PointerEventsCheckLevel.EachTarget })
    await user.click(screen.getByTestId('bulk-more'))
    const items = await screen.findAllByRole('menuitem')
    expect(items.map((i) => i.textContent)).toEqual([
      'Cancelar (2)',
      'Renegociar (2)Selecione cobranças do mesmo paciente',
      'Reativar (2)',
    ])
    expect(items[1]).toHaveAttribute('aria-disabled', 'true')

    await user.click(screen.getByRole('menuitem', { name: 'Reativar (2)' }))
    expect(await screen.findByTestId('uncancel-reason')).toBeInTheDocument()
  })

  it('shows singular text for one selected', () => {
    render(
      <BulkActionBar
        selectedCount={1}
        selectedInstallmentIds={['a']}
        selectedEntryIds={['e1']}
        onClear={() => {}}
        onRenegotiate={() => {}}
      />,
      { wrapper: createWrapper() },
    )
    expect(screen.getByTestId('bulk-action-bar')).toHaveTextContent('1 selecionado')
  })

  it('hides Reativar when canUncancel is false, shows it when true', () => {
    const { rerender } = render(
      <BulkActionBar
        selectedCount={2}
        selectedInstallmentIds={[]}
        selectedEntryIds={['e1', 'e2']}
        canUncancel={false}
        onClear={() => {}}
        onRenegotiate={() => {}}
      />,
      { wrapper: createWrapper() },
    )
    expect(screen.queryByText(/Reativar/)).not.toBeInTheDocument()

    rerender(
      <BulkActionBar
        selectedCount={2}
        selectedInstallmentIds={[]}
        selectedEntryIds={['e1', 'e2']}
        canUncancel={true}
        onClear={() => {}}
        onRenegotiate={() => {}}
      />,
    )
    expect(screen.getByText(/Reativar \(2\)/)).toBeInTheDocument()
  })

  it('confirming reativar calls the mutation with the selected entry ids and the typed reason', async () => {
    render(
      <BulkActionBar
        selectedCount={2}
        selectedInstallmentIds={[]}
        selectedEntryIds={['e1', 'e2']}
        canUncancel={true}
        onClear={() => {}}
        onRenegotiate={() => {}}
      />,
      { wrapper: createWrapper() },
    )

    fireEvent.click(screen.getByText(/Reativar \(2\)/))
    fireEvent.change(screen.getByTestId('uncancel-reason'), { target: { value: 'Erro no cancelamento' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar Reativação' }))

    await waitFor(() => {
      expect(mockBulkUncancel).toHaveBeenCalledWith({
        entryIds: ['e1', 'e2'],
        reason: 'Erro no cancelamento',
      })
    })
  })

  it('keeps confirm disabled while the reativar reason is empty', () => {
    render(
      <BulkActionBar
        selectedCount={1}
        selectedInstallmentIds={[]}
        selectedEntryIds={['e1']}
        canUncancel={true}
        onClear={() => {}}
        onRenegotiate={() => {}}
      />,
      { wrapper: createWrapper() },
    )

    fireEvent.click(screen.getByText(/Reativar \(1\)/))
    expect(screen.getByRole('button', { name: 'Confirmar Reativação' })).toBeDisabled()
  })

  it('bulk pay sends the picked date as BR noon', async () => {
    render(
      <BulkActionBar
        selectedCount={2}
        selectedInstallmentIds={['a', 'b']}
        selectedEntryIds={['e1', 'e2']}
        onClear={() => {}}
        onRenegotiate={() => {}}
      />,
      { wrapper: createWrapper() },
    )

    fireEvent.click(screen.getByText(/Receber \(2\)/))
    fireEvent.change(screen.getByTestId('bulk-pay-date'), { target: { value: '2026-08-15' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar recebimento' }))

    await waitFor(() => {
      expect(mockBulkPay).toHaveBeenCalledWith(expect.objectContaining({ paidAt: '2026-08-15T15:00:00.000Z' }))
    })
  })

  describe('card bulk pay', () => {
    function quotes(byId: Record<string, number | undefined>) {
      vi.mocked(useInstallmentQuote).mockImplementation(
        (id: string) =>
          ({
            data: byId[id] === undefined ? undefined : { totalDue: byId[id] },
            error: null,
          }) as ReturnType<typeof useInstallmentQuote>,
      )
    }

    function openCardDialog() {
      render(
        <BulkActionBar
          selectedCount={2}
          selectedInstallmentIds={['a', 'b']}
          selectedEntryIds={['e1', 'e2']}
          onClear={() => {}}
          onRenegotiate={() => {}}
        />,
        { wrapper: createWrapper() },
      )
      fireEvent.click(screen.getByText(/Receber \(2\)/))
      fireEvent.change(screen.getByTestId('method-select'), { target: { value: 'credit_card' } })
    }

    it('keeps confirm disabled on Calculando... until every quote resolves, then prices the sum', async () => {
      quotes({ a: 500, b: undefined })
      openCardDialog()

      expect(screen.getByText('Calculando...')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Confirmar recebimento' })).toBeDisabled()

      quotes({ a: 500, b: 530.5 })
      fireEvent.change(screen.getByTestId('bulk-pay-date'), { target: { value: '2026-08-15' } })

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Confirmar recebimento' })).not.toBeDisabled()
      })
      expect(screen.getByText('R$ 1.030,50', { exact: false })).toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: 'Confirmar recebimento' }))
      await waitFor(() => {
        expect(mockBulkPay).toHaveBeenCalledWith(
          expect.objectContaining({
            paymentMethod: 'credit_card',
            card: { terminalId: 'term-1', installmentCount: 1, expectedRate: 4 },
          }),
        )
      })
    })

    it('sends no card for pix', async () => {
      quotes({})
      render(
        <BulkActionBar
          selectedCount={2}
          selectedInstallmentIds={['a', 'b']}
          selectedEntryIds={['e1', 'e2']}
          onClear={() => {}}
          onRenegotiate={() => {}}
        />,
        { wrapper: createWrapper() },
      )
      fireEvent.click(screen.getByText(/Receber \(2\)/))
      fireEvent.click(screen.getByRole('button', { name: 'Confirmar recebimento' }))

      await waitFor(() => {
        expect(mockBulkPay).toHaveBeenCalledTimes(1)
      })
      expect(mockBulkPay.mock.calls[0][0].card).toBeUndefined()
    })
  })
})
