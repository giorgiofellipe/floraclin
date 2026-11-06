import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'

const mutate = () => ({ mutateAsync: vi.fn().mockResolvedValue({}), mutate: vi.fn(), reset: vi.fn(), isPending: false, data: undefined, error: null })

const state = vi.hoisted(() => ({
  accounts: [] as Array<Record<string, unknown>>,
  lines: [] as Array<Record<string, unknown>>,
  candidates: [] as Array<Record<string, unknown>>,
  undo: vi.fn().mockResolvedValue({}),
  allocate: vi.fn().mockResolvedValue({}),
  confirmDistinct: vi.fn().mockResolvedValue({}),
}))

vi.mock('@/hooks/queries/use-financial-accounts', () => ({
  useFinancialAccounts: () => ({ data: { data: state.accounts, canManage: true } }),
}))
vi.mock('@/hooks/queries/use-financial-settings', () => ({
  useExpenseCategories: () => ({ data: { data: [{ id: 'cat-1', name: 'Tarifas' }] } }),
}))
vi.mock('@/hooks/queries/use-bank-reconciliation', () => ({
  useStatementLines: () => ({ data: { lines: state.lines, hasMore: false }, isLoading: false, error: null }),
  useMatchCandidates: () => ({ data: state.candidates, isLoading: false }),
  useUndoMatch: () => ({ mutateAsync: state.undo, isPending: false }),
  useUnignoreLine: () => ({ mutateAsync: vi.fn().mockResolvedValue({}), isPending: false }),
  useConfirmDistinctLine: () => ({ mutateAsync: state.confirmDistinct, isPending: false }),
  useAllocateLine: () => ({ mutateAsync: state.allocate, isPending: false }),
  useIgnoreLine: () => mutate(),
  useCreateExpenseFromLine: () => mutate(),
  usePreviewStatementImport: () => mutate(),
  useCommitStatementImport: () => mutate(),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import { ReconciliationView } from '../reconciliation-view'

const line = (over: Record<string, unknown>) => ({
  id: 'l1',
  accountId: 'acc',
  importId: 'i1',
  postedDate: '2026-10-31',
  amountCents: 15000,
  memo: 'PIX RECEBIDO',
  fitid: 'A',
  trnType: 'CREDIT',
  suspectedDuplicateOf: null,
  suspectReviewedAt: null,
  ignoredAt: null,
  ignoreReason: null,
  allocatedCents: 0,
  status: 'open',
  allocations: [],
  ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  state.accounts = [{ id: 'acc', kind: 'bank', name: 'Itaú', archivedAt: null }, { id: 'cx', kind: 'cash', name: 'Caixa', archivedAt: null }]
  state.lines = []
  state.candidates = []
})

describe('ReconciliationView', () => {
  it('asks for a bank account when the clinic has none', () => {
    state.accounts = [{ id: 'cx', kind: 'cash', name: 'Caixa', archivedAt: null }]
    render(<ReconciliationView />)

    expect(screen.getByTestId('reconciliation-no-bank')).toBeInTheDocument()
    expect(screen.queryByText('Importar extrato (OFX)')).not.toBeInTheDocument()
  })

  it('shows the printed BR day and the signed amount of each line', () => {
    state.lines = [line({}), line({ id: 'l2', amountCents: -3990, memo: 'TARIFA', fitid: 'B' })]
    render(<ReconciliationView />)

    const rows = screen.getAllByTestId('statement-line')
    expect(within(rows[0]).getByText('31/10/2026')).toBeInTheDocument()
    expect(rows[0]).toHaveTextContent('+R$')
    expect(rows[1]).toHaveTextContent('-R$')
    // Only debits can become an expense.
    expect(within(rows[0]).queryByText('Criar despesa')).not.toBeInTheDocument()
    expect(within(rows[1]).getByText('Criar despesa')).toBeInTheDocument()
  })

  it('flags a suspected duplicate and lets the user keep it as a distinct line', async () => {
    state.lines = [line({ suspectedDuplicateOf: 'other' })]
    render(<ReconciliationView />)

    expect(screen.getByTestId('suspect-note')).toBeInTheDocument()
    fireEvent.click(screen.getByText('É outro lançamento'))
    await waitFor(() => expect(state.confirmDistinct).toHaveBeenCalledWith('l1'))
  })

  it('undoes a match for the whole line, saying the payment is untouched', async () => {
    state.lines = [line({ status: 'matched', allocatedCents: 15000, allocations: [{ id: 'a1', movementId: 'm1', amountCents: 15000, description: 'Pagamento Maria', movementDate: '2026-10-31T15:00:00Z' }] })]
    render(<ReconciliationView />)

    expect(screen.getByText(/Pagamento Maria/)).toBeInTheDocument()
    fireEvent.click(screen.getByText('Desfazer'))
    await waitFor(() => expect(state.undo).toHaveBeenCalledWith({ lineId: 'l1' }))
  })

  it('splits one credit across two movements and blocks totals above the line', async () => {
    state.lines = [line({ amountCents: 30000 })]
    state.candidates = [
      { id: 'm1', description: 'Repasse 1/2', type: 'inflow', amount: '180.00', paymentMethod: null, movementDate: '2026-10-31T15:00:00Z', remainingCents: 18000, dayDistance: 0, reversalPair: false },
      { id: 'm2', description: 'Repasse 2/2', type: 'inflow', amount: '150.00', paymentMethod: null, movementDate: '2026-10-31T15:00:00Z', remainingCents: 15000, dayDistance: 0, reversalPair: false },
    ]
    render(<ReconciliationView />)
    fireEvent.click(screen.getByText('Conciliar'))

    fireEvent.click(await screen.findByLabelText('Escolher Repasse 1/2'))
    fireEvent.click(screen.getByLabelText('Escolher Repasse 2/2'))
    // First takes its 180,00; the second is proposed only what the line still needs: 120,00.
    expect(screen.getByLabelText('Valor de Repasse 1/2')).toHaveValue('180,00')
    expect(screen.getByLabelText('Valor de Repasse 2/2')).toHaveValue('120,00')

    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Conciliar' }))
    await waitFor(() =>
      expect(state.allocate).toHaveBeenCalledWith({
        lineId: 'l1',
        allocations: [
          { movementId: 'm1', amountCents: 18000 },
          { movementId: 'm2', amountCents: 12000 },
        ],
      }),
    )
  })
})
