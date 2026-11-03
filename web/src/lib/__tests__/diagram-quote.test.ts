import { describe, it, expect } from 'vitest'
import { quoteTotal, buildCartFromQuote } from '@/lib/diagram-quote'
import { encounterCartSchema, computeCartTotal } from '@/validations/encounter-cart'
import type { QuotationLine } from '@/validations/face-diagram-group'

const lines: QuotationLine[] = [
  { procedureTypeId: '11111111-1111-4111-8111-111111111111', procedureTypeName: 'Botox', sessions: 1, unitPrice: 1200 },
  { procedureTypeId: '22222222-2222-4222-8222-222222222222', procedureTypeName: 'Peeling', sessions: 3, unitPrice: 333.33 },
]

describe('quoteTotal', () => {
  it('sums in integer cents', () => {
    expect(quoteTotal(lines)).toBe(2199.99)
  })

  it('does not drift on float-unfriendly prices', () => {
    expect(quoteTotal([{ ...lines[0], unitPrice: 0.1, sessions: 3 }])).toBe(0.3)
  })

  it('returns 0 for no lines', () => {
    expect(quoteTotal([])).toBe(0)
  })
})

describe('buildCartFromQuote', () => {
  it('produces a valid cart whose total equals the quote total', () => {
    const cart = buildCartFromQuote(lines)
    expect(encounterCartSchema.parse(cart)).toEqual(cart)
    expect(computeCartTotal(cart)).toBeCloseTo(quoteTotal(lines), 2)
  })

  it('carries custom unit prices into the cart lines', () => {
    const cart = buildCartFromQuote(lines)
    expect(cart.lines.map((l) => l.defaultPrice)).toEqual([1200, 333.33])
    expect(cart.templateId).toBeNull()
    expect(cart.totalOverride).toBeNull()
  })
})
