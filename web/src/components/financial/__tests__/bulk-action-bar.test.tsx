import { afterEach, describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BulkActionBar } from '../bulk-action-bar'

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

afterEach(() => {
  vi.useRealTimers()
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
    expect(screen.getByText(/Marcar como pago \(2\)/)).toBeInTheDocument()
    expect(screen.getByText(/Cancelar \(2\)/)).toBeInTheDocument()
    expect(screen.getByText(/Renegociar \(2\)/)).toBeInTheDocument()
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

  it('bulk pay with no date selected sends paidAt: undefined and does not throw', async () => {
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

    fireEvent.click(screen.getByText(/Marcar como pago \(2\)/))
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }))

    await waitFor(() => {
      expect(mockBulkPay).toHaveBeenCalledWith(
        expect.objectContaining({ paidAt: undefined }),
      )
    })
  })

  it('bulk pay with today selected sends paidAt: undefined', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-08-20T15:00:00Z')) // BR noon on 2026-08-20

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

    fireEvent.click(screen.getByText(/Marcar como pago \(2\)/))
    fireEvent.change(screen.getByTestId('bulk-pay-date'), { target: { value: '2026-08-20' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }))

    await waitFor(() => {
      expect(mockBulkPay).toHaveBeenCalledWith(
        expect.objectContaining({ paidAt: undefined }),
      )
    })
  })

  it('bulk pay with a past date sends BR noon of that day', async () => {
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

    fireEvent.click(screen.getByText(/Marcar como pago \(2\)/))
    fireEvent.change(screen.getByTestId('bulk-pay-date'), { target: { value: '2026-08-15' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }))

    await waitFor(() => {
      expect(mockBulkPay).toHaveBeenCalledWith(
        expect.objectContaining({ paidAt: '2026-08-15T15:00:00.000Z' }),
      )
    })
  })
})
