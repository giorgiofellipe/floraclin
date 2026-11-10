import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'

const mutate = () => ({ mutateAsync: vi.fn().mockResolvedValue({}), mutate: vi.fn(), reset: vi.fn(), isPending: false, data: undefined, error: null })

const state = vi.hoisted(() => ({
  accounts: [] as Array<Record<string, unknown>>,
  lines: [] as Array<Record<string, unknown>>,
  candidates: [] as Array<Record<string, unknown>>,
  undo: vi.fn().mockResolvedValue({}),
  allocate: vi.fn().mockResolvedValue({}),
  confirmDistinct: vi.fn().mockResolvedValue({}),
  refetch: vi.fn().mockResolvedValue({}),
  candidateError: null as Error | null,
  fetching: false,
  remainingCents: 15000,
}))

vi.mock('@/hooks/queries/use-financial-accounts', () => ({
  useFinancialAccounts: () => ({ data: { data: state.accounts, canManage: true } }),
}))
vi.mock('@/hooks/queries/use-financial-settings', () => ({
  useExpenseCategories: () => ({ data: { data: [{ id: 'cat-1', name: 'Tarifas' }] } }),
}))
vi.mock('@/hooks/queries/use-bank-reconciliation', () => ({
  useStatementLines: () => ({ data: { lines: state.lines, hasMore: false }, isLoading: false, error: null }),
  useMatchCandidates: () => ({ data: { candidates: state.candidates, remainingCents: state.remainingCents }, isLoading: false, isFetching: state.fetching, error: state.candidateError, refetch: state.refetch }),
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
  state.candidateError = null
  state.fetching = false
  state.remainingCents = 15000
  state.refetch.mockImplementation(async () => ({ data: { candidates: state.candidates, remainingCents: state.remainingCents }, error: null }))
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
    state.remainingCents = 30000
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

    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Conciliar 2 movimentações' }))
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

const match = (over: Record<string, unknown> = {}) => ({ id: 'm1', description: 'Pagamento Maria Silva', type: 'inflow', amount: '150.00', paymentMethod: null, movementDate: '2026-10-31T15:00:00Z', remainingCents: 15000, dayDistance: 0, reversalPair: false, score: 100, confidence: 'high', reasons: [{ code: 'similar_description', label: 'Descrição semelhante' }], suggested: true, ...over })

describe('suggestion selection safety', () => {
  it('initializes only the server suggestion, shows its Portuguese reasons and requires confirmation', async () => {
    state.lines = [line({})]
    state.candidates = [match()]
    render(<ReconciliationView />)
    fireEvent.click(screen.getByText('Conciliar'))
    expect(await screen.findByLabelText('Escolher Pagamento Maria Silva')).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByText('Descrição semelhante')).toBeInTheDocument()
    expect(state.allocate).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /Conciliar R\$/ }))
    await waitFor(() => expect(state.allocate).toHaveBeenCalledWith({ lineId: 'l1', allocations: [{ movementId: 'm1', amountCents: 15000 }] }))
  })

  it('does not reselect a suggestion after manual deselection, refetch or a search', async () => {
    state.lines = [line({})]; state.candidates = [match()]
    const view = render(<ReconciliationView />)
    fireEvent.click(screen.getByText('Conciliar'))
    fireEvent.click(await screen.findByLabelText('Escolher Pagamento Maria Silva'))
    state.candidates = [match()]
    view.rerender(<ReconciliationView />)
    fireEvent.change(screen.getByLabelText('Buscar movimentação'), { target: { value: 'Maria' } })
    expect(screen.getByLabelText('Escolher Pagamento Maria Silva')).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByRole('dialog')).not.toHaveTextContent('Valor a conciliar')
  })

  it('keeps a selected movement visible when search results do not contain it', async () => {
    state.lines = [line({})]; state.candidates = [match()]
    const view = render(<ReconciliationView />)
    fireEvent.click(screen.getByText('Conciliar'))
    expect(await screen.findByLabelText('Valor de Pagamento Maria Silva')).toHaveValue('150,00')
    fireEvent.change(screen.getByLabelText('Buscar movimentação'), { target: { value: 'Ana' } })
    state.candidates = []
    view.rerender(<ReconciliationView />)
    expect(screen.getByLabelText('Valor de Pagamento Maria Silva')).toHaveValue('150,00')
  })

  it('blocks a zero-value second selection and permits splitting after reducing the first amount', async () => {
    state.lines = [line({})]; state.candidates = [match(), match({ id: 'm2', description: 'Pagamento Ana Costa', suggested: false })]
    render(<ReconciliationView />)
    fireEvent.click(screen.getByText('Conciliar'))
    const second = await screen.findByLabelText('Escolher Pagamento Ana Costa')
    expect(second).toBeDisabled()
    expect(screen.getByText('Já coberto')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Valor de Pagamento Maria Silva'), { target: { value: '10000' } })
    fireEvent.click(second)
    expect(screen.getByLabelText('Valor de Pagamento Ana Costa')).toHaveValue('50,00')
    fireEvent.change(screen.getByLabelText('Valor de Pagamento Ana Costa'), { target: { value: '6000' } })
    expect(screen.getByRole('button', { name: 'Conciliar 2 movimentações' })).toBeDisabled()
  })

  it('blocks stale balances until suggestions are explicitly refreshed and clears old choices', async () => {
    state.lines = [line({})]; state.candidates = [match()]
    const view = render(<ReconciliationView />)
    fireEvent.click(screen.getByText('Conciliar'))
    await screen.findByLabelText('Valor de Pagamento Maria Silva')
    state.candidates = [match({ remainingCents: 5000, suggested: false })]
    view.rerender(<ReconciliationView />)
    expect(screen.getByRole('button', { name: /Conciliar R\$/ })).toBeDisabled()
    await act(async () => { fireEvent.click(screen.getByText('Atualizar sugestões')) })
    expect(state.refetch).toHaveBeenCalled()
    expect(screen.queryByLabelText('Valor de Pagamento Maria Silva')).not.toBeInTheDocument()
  })

  it('does not preselect reversal pairs and blocks saving during candidate errors', async () => {
    state.lines = [line({})]; state.candidates = [match({ reversalPair: true, suggested: false, confidence: 'low' })]
    const view = render(<ReconciliationView />)
    fireEvent.click(screen.getByText('Conciliar'))
    expect(await screen.findByLabelText('Escolher Pagamento Maria Silva')).toHaveAttribute('aria-checked', 'false')
    fireEvent.click(screen.getByLabelText('Escolher Pagamento Maria Silva'))
    state.candidateError = new Error('offline')
    view.rerender(<ReconciliationView />)
    expect(screen.getByRole('button', { name: /Conciliar R\$/ })).toBeDisabled()
    fireEvent.click(screen.getByText('Tentar de novo'))
    expect(state.refetch).toHaveBeenCalled()
  })
})

describe('live statement balance', () => {
  it('refreshes the line budget even when another user fully reconciled it', async () => {
    state.lines = [line({})]; state.candidates = [match()]
    const view = render(<ReconciliationView />)
    fireEvent.click(screen.getByText('Conciliar'))
    await screen.findByLabelText('Valor de Pagamento Maria Silva')
    state.remainingCents = 0; state.candidates = []
    view.rerender(<ReconciliationView />)
    expect(screen.getByText(/Os dados mudaram/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Conciliar R\$/ })).toBeDisabled()
    await act(async () => { fireEvent.click(screen.getByText('Atualizar sugestões')) })
    expect(screen.queryByLabelText('Valor de Pagamento Maria Silva')).not.toBeInTheDocument()
    expect(screen.getByRole('dialog')).toHaveTextContent('de R$ 0,00')
  })
})

describe('allocation conflicts and intentional partial reconciliation', () => {
  it('refreshes suggestions after a server-side allocation conflict', async () => {
    state.lines = [line({})]; state.candidates = [match()]
    state.allocate.mockRejectedValueOnce(Object.assign(new Error('Saldo alterado'), { code: 'ALLOCATION_OVER_LINE' }))
    render(<ReconciliationView />)
    fireEvent.click(screen.getByText('Conciliar'))
    fireEvent.click(await screen.findByRole('button', { name: /Conciliar R\$/ }))
    await screen.findByText(/Os dados mudaram/)
    state.remainingCents = 5000
    await act(async () => { fireEvent.click(screen.getByText('Atualizar sugestões')) })
    await waitFor(() => expect(screen.queryByText(/Os dados mudaram/)).not.toBeInTheDocument())
    expect(screen.queryByLabelText('Valor de Pagamento Maria Silva')).not.toBeInTheDocument()
  })

  it('allows the user to confirm a positive partial amount', async () => {
    state.lines = [line({})]; state.candidates = [match()]
    render(<ReconciliationView />)
    fireEvent.click(screen.getByText('Conciliar'))
    fireEvent.change(await screen.findByLabelText('Valor de Pagamento Maria Silva'), { target: { value: '10000' } })
    const confirm = screen.getByRole('button', { name: /Conciliar R\$/ })
    expect(confirm).toBeEnabled()
    fireEvent.click(confirm)
    await waitFor(() => expect(state.allocate).toHaveBeenCalledWith({ lineId: 'l1', allocations: [{ movementId: 'm1', amountCents: 10000 }] }))
  })
})
