import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CardRepassesView } from '../card-repasses-view'
import { AdjustRepasseDialog } from '../adjust-repasse-dialog'

const row = (over: Record<string, unknown>) => ({
  id: 'r',
  cardPaymentId: 'cp',
  sequence: 1,
  expectedDate: '2026-10-20',
  terminalName: 'Stone',
  patientId: 'p',
  patientName: 'Maria Silva',
  method: 'credit_card',
  grossAmount: '100.00',
  feeAmount: '3.00',
  netAmount: '97.00',
  status: 'pending',
  receivedAt: null,
  ...over,
})

const repasses = {
  data: [
    row({ id: 'r1', status: 'pending', patientName: 'Ana Pendente' }),
    row({ id: 'r2', status: 'received', patientName: 'Bia Recebida' }),
    row({ id: 'r3', status: 'cancelled', patientName: 'Cris Cancelada' }),
    row({ id: 'r4', status: 'pending', patientName: 'Dani Estornada', cardPaymentReversed: true }),
  ],
  total: 4,
  pendingNetTotal: 1234.5,
}

const useCardRepassesMock = vi.fn()

vi.mock('@/hooks/queries/use-card-repasses', () => ({
  useCardRepasses: (filters: unknown) => useCardRepassesMock(filters),
  useAdjustCardRepasse: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))

vi.mock('@/hooks/queries/use-card-terminals', () => ({
  useCardTerminals: () => ({ data: { data: [{ id: 't1', name: 'Stone' }] } }),
}))

const loaded = { data: repasses, isPending: false, isFetching: false, isError: false }

afterEach(() => {
  vi.useRealTimers()
})

describe('CardRepassesView', () => {
  beforeEach(() => {
    useCardRepassesMock.mockReturnValue(loaded)
  })

  it('shows the pending net total and a status label per repasse', () => {
    render(<CardRepassesView />)

    expect(screen.getByText('A receber das maquininhas')).toBeInTheDocument()
    expect(screen.getByTestId('pending-net-total')).toHaveTextContent('R$ 1.234,50')
    const rows = screen.getAllByRole('row')
    expect(rows[1]).toHaveTextContent('Aguardando repasse')
    expect(rows[2]).toHaveTextContent('Recebido')
    expect(rows[3]).toHaveTextContent('Cancelado')
  })

  it('offers "Ajustar repasse" for pending and received rows, not cancelled', () => {
    render(<CardRepassesView />)

    const rows = screen.getAllByRole('row')
    expect(rows[1]).toHaveTextContent('Ajustar repasse')
    expect(rows[2]).toHaveTextContent('Ajustar repasse')
    expect(rows[3]).not.toHaveTextContent('Ajustar repasse')
  })

  it('hides "Ajustar repasse" when the card payment was reversed', () => {
    render(<CardRepassesView />)

    const rows = screen.getAllByRole('row')
    expect(rows[4]).toHaveTextContent('Dani Estornada')
    expect(rows[4]).not.toHaveTextContent('Ajustar repasse')
  })

  it('defaults the period to the whole current month', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-02-10T15:00:00Z'))
    render(<CardRepassesView />)

    expect(useCardRepassesMock).toHaveBeenCalledWith(
      expect.objectContaining({ dateFrom: '2026-02-01', dateTo: '2026-02-28' }),
    )
  })

  it('shows an error row when the query fails', () => {
    useCardRepassesMock.mockReturnValue({ ...loaded, data: undefined, isError: true })
    render(<CardRepassesView />)

    expect(screen.getByText('Não foi possível carregar os repasses.')).toBeInTheDocument()
    expect(screen.queryByText('Nenhum repasse encontrado no período.')).not.toBeInTheDocument()
  })

  it('opens the adjust dialog from a row', async () => {
    render(<CardRepassesView />)

    await userEvent.click(screen.getAllByText('Ajustar repasse')[0])
    expect(screen.getByLabelText('Valor líquido (R$)')).toBeInTheDocument()
  })
})

describe('AdjustRepasseDialog', () => {
  const base = { open: true, onOpenChange: () => {} }
  const notice = 'O lançamento anterior no extrato será estornado e um novo será criado.'

  it('warns that the ledger entry is reversed for a received repasse', () => {
    render(<AdjustRepasseDialog {...base} repasse={row({ status: 'received' }) as never} />)
    expect(screen.getByText(notice)).toBeInTheDocument()
  })

  it('blocks saving when the net amount exceeds the gross amount', async () => {
    render(<AdjustRepasseDialog {...base} repasse={row({ grossAmount: '100.00' }) as never} />)

    const input = screen.getByLabelText('Valor líquido (R$)')
    await userEvent.clear(input)
    await userEvent.type(input, '100.01')
    expect(screen.getByRole('button', { name: 'Salvar' })).toBeDisabled()

    await userEvent.clear(input)
    await userEvent.type(input, '100')
    expect(screen.getByRole('button', { name: 'Salvar' })).toBeEnabled()
  })

  it('shows no reversal notice for a pending repasse', () => {
    render(<AdjustRepasseDialog {...base} repasse={row({ status: 'pending' }) as never} />)
    expect(screen.queryByText(notice)).not.toBeInTheDocument()
  })
})
