import { describe, it, expect } from 'vitest'
import { buildFinalizeBody } from '../build-finalize-body'
import type { EncounterCart } from '@/validations/encounter-cart'

const base = {
  cart: { lines: [] } as unknown as EncounterCart,
  draftRecordIds: ['r1'],
  patientId: 'p1',
  practitionerId: 'u1',
  financialPlan: { totalAmount: 100, installmentCount: 3, paymentMethod: 'credit_card' },
}

describe('buildFinalizeBody', () => {
  it('sends cardPayment when card is paid now with a terminal', () => {
    const body = buildFinalizeBody({ ...base, card: { cardNow: true, terminalId: 't1', expectedRate: 8.99 } })
    expect(body.cardPayment).toEqual({ terminalId: 't1', expectedRate: 8.99 })
  })

  it('omits cardPayment when the box is unchecked, even with a terminal chosen', () => {
    const body = buildFinalizeBody({ ...base, card: { cardNow: false, terminalId: 't1', expectedRate: 8.99 } })
    expect('cardPayment' in body).toBe(false)
  })

  it('omits cardPayment when checked without a terminal', () => {
    const body = buildFinalizeBody({ ...base, card: { cardNow: true, terminalId: null, expectedRate: 8.99 } })
    expect('cardPayment' in body).toBe(false)
  })

  it('omits cardPayment when checked without a displayed rate', () => {
    const body = buildFinalizeBody({ ...base, card: { cardNow: true, terminalId: 't1', expectedRate: null } })
    expect('cardPayment' in body).toBe(false)
  })
})
