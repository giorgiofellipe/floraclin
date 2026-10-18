import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { CardPaymentFields } from '../card-payment-fields'
import { useCardTerminals } from '@/hooks/queries/use-card-terminals'

vi.mock('@/hooks/queries/use-card-terminals', () => ({
  useCardTerminals: vi.fn(),
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

function mockTerminals(rows: unknown[]) {
  vi.mocked(useCardTerminals).mockReturnValue({ data: { data: rows }, isLoading: false } as never)
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
        value={{ terminalId: 'term-1', installmentCount: 6 }}
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
        value={{ terminalId: 'term-1', installmentCount: 6 }}
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
        value={{ terminalId: 'term-1', installmentCount: 1 }}
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
        value={{ terminalId: null, installmentCount: 1 }}
        onChange={onChange}
      />,
    )
    expect(onChange).toHaveBeenCalledWith({ terminalId: 'b', installmentCount: 1 })
  })

  it('asks to register a terminal when there are none', () => {
    mockTerminals([])
    render(
      <CardPaymentFields
        method="credit_card"
        gross={100}
        paymentYmd="2026-10-19"
        value={{ terminalId: null, installmentCount: 1 }}
        onChange={vi.fn()}
      />,
    )
    expect(screen.getByText('Cadastre uma maquininha em Configurações › Financeiro.')).toBeTruthy()
    expect(screen.queryByText('Você recebe')).toBeNull()
  })
})
