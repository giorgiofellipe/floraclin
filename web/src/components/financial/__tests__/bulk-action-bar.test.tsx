import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BulkActionBar } from '../bulk-action-bar'

// Mock mutations
vi.mock('@/hooks/mutations/use-financial-mutations', () => ({
  useBulkPay: () => ({
    mutateAsync: vi.fn().mockResolvedValue({}),
    isPending: false,
  }),
  useBulkCancel: () => ({
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
})
