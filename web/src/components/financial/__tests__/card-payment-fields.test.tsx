import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { CardPaymentFields, toCardPayload } from '../card-payment-fields'
import { useCardTerminals } from '@/hooks/queries/use-card-terminals'

const createMutateAsync = vi.fn()

vi.mock('@/hooks/queries/use-card-terminals', () => ({
  useCardTerminals: vi.fn(),
  useCreateCardTerminal: () => ({ mutateAsync: createMutateAsync, isPending: false }),
  useUpdateCardTerminal: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))

const rates = (index: number, rate: string) =>
  Array.from({ length: 12 }, (_, i) => (i === index ? rate : '0.00'))

function terminal(overrides: Record<string, unknown> = {}) {
  return {
    id: 'term-1',
    name: 'Stone',
    isDefault: true,
    debitRate: '1.50',
    debitPayoutDays: 1,
    creditRates: rates(5, '8.99'),
    creditPayoutMode: 'per_installment',
    creditLumpSumDays: 1,
    ...overrides,
  }
}

function mockLoading(state: { isLoading?: boolean; isError?: boolean }) {
  vi.mocked(useCardTerminals).mockReturnValue({
    data: undefined,
    isLoading: false,
    isError: false,
    ...state,
  } as never)
}

function mockTerminals(rows: unknown[], canManage = true) {
  vi.mocked(useCardTerminals).mockReturnValue({ data: { data: rows, canManage }, isLoading: false } as never)
}

const nbsp = (s: string) => s.replace(/\u00a0/g, " ")

beforeEach(() => {
  vi.clearAllMocks()
})

describe('CardPaymentFields', () => {
  it('shows the per-installment summary for a 6x credit sale', () => {
    mockTerminals([terminal()])
    const { container } = render(
      <CardPaymentFields
        method="credit_card"
        gross={3000}
        paymentYmd="2026-10-18"
        value={{ terminalId: 'term-1', installmentCount: 6, expectedRate: null }}
        onChange={vi.fn()}
      />,
    )
    const text = nbsp(container.textContent ?? '')
    expect(text).toContain('Taxa (8,99%)')
    expect(text).toContain('R$ 269,70')
    expect(text).toContain('R$ 2.730,30')
    expect(text).toContain('6 repasses de R$ 455,05, a partir de 17/11/2026')
  })

  it('labels the fee as antecipação for a lump-sum terminal', () => {
    mockTerminals([
      terminal({ creditRates: rates(5, '11.49'), creditPayoutMode: 'lump_sum' }),
    ])
    const { container } = render(
      <CardPaymentFields
        method="credit_card"
        gross={3000}
        paymentYmd="2026-10-18"
        value={{ terminalId: 'term-1', installmentCount: 6, expectedRate: null }}
        onChange={vi.fn()}
      />,
    )
    const text = nbsp(container.textContent ?? '')
    expect(text).toContain('Taxa com antecipação (11,49%)')
    expect(text).toContain('1 repasse de R$ 2.655,30 em 19/10/2026 (antecipado)')
  })

  it('hides Parcelas no cartão for debit', () => {
    mockTerminals([terminal()])
    render(
      <CardPaymentFields
        method="debit_card"
        gross={100}
        paymentYmd="2026-10-19"
        value={{ terminalId: 'term-1', installmentCount: 1, expectedRate: null }}
        onChange={vi.fn()}
      />,
    )
    expect(screen.queryByText('Parcelas no cartão')).toBeNull()
    expect(screen.getByText('Maquininha')).toBeTruthy()
  })

  it('preselects the default terminal when none is chosen', () => {
    mockTerminals([terminal({ id: 'a', isDefault: false }), terminal({ id: 'b', isDefault: true })])
    const onChange = vi.fn()
    render(
      <CardPaymentFields
        method="credit_card"
        gross={100}
        paymentYmd="2026-10-19"
        value={{ terminalId: null, installmentCount: 1, expectedRate: null }}
        onChange={onChange}
      />,
    )
    expect(onChange).toHaveBeenCalledWith({ terminalId: 'b', installmentCount: 1, expectedRate: null })
  })

  it('reports the displayed schedule rate as expectedRate', () => {
    mockTerminals([terminal()])
    const onChange = vi.fn()
    render(
      <CardPaymentFields
        method="credit_card"
        gross={3000}
        paymentYmd="2026-10-18"
        value={{ terminalId: 'term-1', installmentCount: 6, expectedRate: null }}
        onChange={onChange}
      />,
    )
    expect(onChange).toHaveBeenCalledWith({ terminalId: 'term-1', installmentCount: 6, expectedRate: 8.99 })
  })

  it('does not re-report a rate that already matches the schedule', () => {
    mockTerminals([terminal()])
    const onChange = vi.fn()
    render(
      <CardPaymentFields
        method="credit_card"
        gross={3000}
        paymentYmd="2026-10-18"
        value={{ terminalId: 'term-1', installmentCount: 6, expectedRate: 8.99 }}
        onChange={onChange}
      />,
    )
    expect(onChange).not.toHaveBeenCalled()
  })

  const emptyProps = {
    method: 'credit_card' as const,
    gross: 100,
    paymentYmd: '2026-10-19',
    value: { terminalId: null, installmentCount: 1, expectedRate: null },
  }

  it('lets an owner register the first terminal and selects it', async () => {
    mockTerminals([], true)
    createMutateAsync.mockResolvedValue({ success: true, data: terminal({ id: 'new-term' }) })
    const onChange = vi.fn()
    render(<CardPaymentFields {...emptyProps} onChange={onChange} />)

    fireEvent.click(screen.getByRole('button', { name: 'Cadastrar maquininha' }))
    fireEvent.change(screen.getByLabelText('Nome'), { target: { value: 'Stone' } })
    fireEvent.change(screen.getByLabelText('Taxa (%)'), { target: { value: '1,5' } })
    for (let i = 1; i <= 12; i++) {
      fireEvent.change(screen.getByLabelText(`${i}x`), { target: { value: '3' } })
    }
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))

    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith({ terminalId: 'new-term', installmentCount: 1, expectedRate: null }),
    )
    expect(screen.queryByText('Você recebe')).toBeNull()
  })

  it('tells a non-owner to ask the owner instead of offering the form', () => {
    mockTerminals([], false)
    render(<CardPaymentFields {...emptyProps} onChange={vi.fn()} />)
    expect(screen.getByText('Peça ao responsável da clínica para cadastrar uma maquininha.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Cadastrar maquininha' })).toBeNull()
  })
})

describe('CardPaymentFields load states', () => {
  const props = {
    method: 'credit_card' as const,
    gross: 100,
    paymentYmd: '2026-10-19',
    value: { terminalId: null, installmentCount: 1, expectedRate: null },
    onChange: vi.fn(),
  }

  it('shows a loading message instead of the empty-state while terminals load', () => {
    mockLoading({ isLoading: true })
    render(<CardPaymentFields {...props} />)
    expect(screen.getByText('Carregando maquininhas...')).toBeTruthy()
    expect(screen.queryByText(/Cadastre uma maquininha/)).toBeNull()
  })

  it('shows an error message instead of the empty-state when terminals fail to load', () => {
    mockLoading({ isError: true })
    render(<CardPaymentFields {...props} />)
    expect(screen.getByText('Não foi possível carregar as maquininhas.')).toBeTruthy()
    expect(screen.queryByText(/Cadastre uma maquininha/)).toBeNull()
  })
})

describe('toCardPayload', () => {
  it.each([
    ['credit_card', { terminalId: 't1', installmentCount: 6, expectedRate: 8.99 }, { terminalId: 't1', installmentCount: 6, expectedRate: 8.99 }],
    ['debit_card', { terminalId: 't1', installmentCount: 6, expectedRate: 1.5 }, { terminalId: 't1', installmentCount: 1, expectedRate: 1.5 }],
    ['credit_card', { terminalId: null, installmentCount: 6, expectedRate: 8.99 }, undefined],
    ['credit_card', { terminalId: 't1', installmentCount: 6, expectedRate: null }, undefined],
    ['pix', { terminalId: 't1', installmentCount: 6, expectedRate: 8.99 }, undefined],
  ])('%s with %o gives %o', (method, value, expected) => {
    expect(toCardPayload(method, value)).toEqual(expected)
  })
})
