import { describe, expect, it } from 'vitest'
import { buildContractData } from '../contract-interpolation'

function build(plan: { installmentCount: number; paymentMethod: 'pix' | 'credit_card' | 'debit_card' }) {
  return buildContractData([], [], { totalAmount: 600, ...plan }, { fullName: 'Ana' }, 'Dra. Bia', 'Clínica')
}

describe('buildContractData formaPagamento', () => {
  it.each([
    { plan: { installmentCount: 6, paymentMethod: 'credit_card' as const }, expected: 'Cartão de crédito em 6x' },
    { plan: { installmentCount: 1, paymentMethod: 'credit_card' as const }, expected: 'Cartão de Crédito' },
    { plan: { installmentCount: 3, paymentMethod: 'pix' as const }, expected: 'PIX' },
  ])('$plan.paymentMethod in $plan.installmentCount renders $expected', ({ plan, expected }) => {
    expect(build(plan).formaPagamento).toBe(expected)
  })
})
