import { describe, it, expect } from 'vitest'
import {
  isBundleCart,
  computeCartTotal,
  autoPackageName,
  encounterCartSchema,
  type EncounterCart,
  type CartLine,
} from '../encounter-cart'

const PROC_A = '11111111-1111-4111-8111-111111111111'
const PROC_B = '22222222-2222-4222-8222-222222222222'
const TEMPLATE_ID = '33333333-3333-4333-8333-333333333333'
const TEMPLATE_LINE_ID = '44444444-4444-4444-8444-444444444444'

const adhocLine = (overrides?: Partial<CartLine>): CartLine => ({
  procedureTypeId: PROC_A,
  procedureTypeName: 'Botox',
  sessions: 1,
  defaultPrice: 1000,
  sourceTemplateLineId: null,
  ...overrides,
})

const emptyCart = (overrides?: Partial<EncounterCart>): EncounterCart => ({
  templateId: null,
  templateName: null,
  templateDefaultPrice: null,
  templateValidityMonths: null,
  lines: [],
  totalOverride: null,
  ...overrides,
})

describe('isBundleCart', () => {
  it('returns true when a template is selected', () => {
    const cart = emptyCart({
      templateId: TEMPLATE_ID,
      templateName: 'Pacote Premium',
      templateDefaultPrice: 5000,
      templateValidityMonths: 12,
      lines: [adhocLine({ sourceTemplateLineId: TEMPLATE_LINE_ID })],
    })
    expect(isBundleCart(cart)).toBe(true)
  })

  it('returns true when any line has sessions > 1', () => {
    const cart = emptyCart({
      lines: [adhocLine({ sessions: 3 })],
    })
    expect(isBundleCart(cart)).toBe(true)
  })

  it('returns false for a single ad-hoc line with sessions = 1', () => {
    const cart = emptyCart({
      lines: [adhocLine({ sessions: 1 })],
    })
    expect(isBundleCart(cart)).toBe(false)
  })
})

describe('autoPackageName', () => {
  it('returns the template name when a template is selected', () => {
    const cart = emptyCart({
      templateId: TEMPLATE_ID,
      templateName: 'Pacote Skinbooster 6x',
      templateDefaultPrice: 4200,
      templateValidityMonths: 6,
      lines: [adhocLine({ sourceTemplateLineId: TEMPLATE_LINE_ID, sessions: 6 })],
    })
    expect(autoPackageName(cart)).toBe('Pacote Skinbooster 6x')
  })

  it('formats a single multi-session ad-hoc line', () => {
    const cart = emptyCart({
      lines: [adhocLine({ procedureTypeName: 'Limpeza de Pele', sessions: 4 })],
    })
    expect(autoPackageName(cart)).toBe('Pacote Limpeza de Pele — 4 sessões')
  })

  it('formats mixed ad-hoc lines with × separator', () => {
    const cart = emptyCart({
      lines: [
        adhocLine({ procedureTypeId: PROC_A, procedureTypeName: 'Botox', sessions: 2 }),
        adhocLine({ procedureTypeId: PROC_B, procedureTypeName: 'Skinbooster', sessions: 3 }),
      ],
    })
    expect(autoPackageName(cart)).toBe('Pacote: 2× Botox + 3× Skinbooster')
  })
})

describe('computeCartTotal', () => {
  it('returns totalOverride when set', () => {
    const cart = emptyCart({
      lines: [adhocLine({ defaultPrice: 1000, sessions: 3 })],
      totalOverride: 2500,
    })
    expect(computeCartTotal(cart)).toBe(2500)
  })

  it('returns totalOverride when set to 0', () => {
    const cart = emptyCart({
      lines: [adhocLine({ defaultPrice: 1000, sessions: 3 })],
      totalOverride: 0,
    })
    expect(computeCartTotal(cart)).toBe(0)
  })

  it('sums ad-hoc lines (defaultPrice × sessions)', () => {
    const cart = emptyCart({
      lines: [
        adhocLine({ procedureTypeId: PROC_A, defaultPrice: 1000, sessions: 3 }),
        adhocLine({ procedureTypeId: PROC_B, defaultPrice: 500, sessions: 2 }),
      ],
    })
    // 1000*3 + 500*2 = 4000
    expect(computeCartTotal(cart)).toBe(4000)
  })

  it('adds the template subtotal to ad-hoc subtotal', () => {
    const cart = emptyCart({
      templateId: TEMPLATE_ID,
      templateName: 'Pacote Premium',
      templateDefaultPrice: 5000,
      templateValidityMonths: 12,
      lines: [
        adhocLine({ sourceTemplateLineId: TEMPLATE_LINE_ID, defaultPrice: 1000, sessions: 5 }),
        adhocLine({
          procedureTypeId: PROC_B,
          procedureTypeName: 'Extra',
          sourceTemplateLineId: null,
          defaultPrice: 800,
          sessions: 2,
        }),
      ],
    })
    // Template subtotal (5000) + ad-hoc only (800*2 = 1600) = 6600
    expect(computeCartTotal(cart)).toBe(6600)
  })

  it('returns 0 for an empty cart with no template', () => {
    const cart = emptyCart()
    expect(computeCartTotal(cart)).toBe(0)
  })
})

describe('encounterCartSchema', () => {
  it('accepts a valid single ad-hoc cart', () => {
    const cart = emptyCart({ lines: [adhocLine()] })
    const result = encounterCartSchema.safeParse(cart)
    expect(result.success).toBe(true)
  })

  it('rejects empty lines array', () => {
    const cart = emptyCart({ lines: [] })
    const result = encounterCartSchema.safeParse(cart)
    expect(result.success).toBe(false)
  })

  it('rejects sessions < 1', () => {
    const cart = emptyCart({ lines: [adhocLine({ sessions: 0 })] })
    const result = encounterCartSchema.safeParse(cart)
    expect(result.success).toBe(false)
  })

  it('rejects sessions > 50', () => {
    const cart = emptyCart({ lines: [adhocLine({ sessions: 51 })] })
    const result = encounterCartSchema.safeParse(cart)
    expect(result.success).toBe(false)
  })

  it('rejects duplicate procedureTypeId in ad-hoc lines without a template', () => {
    const cart = emptyCart({
      lines: [
        adhocLine({ procedureTypeId: PROC_A }),
        adhocLine({ procedureTypeId: PROC_A, procedureTypeName: 'Botox 2' }),
      ],
    })
    const result = encounterCartSchema.safeParse(cart)
    expect(result.success).toBe(false)
  })

  it('accepts duplicate procedureTypeId when a template is selected', () => {
    const cart = emptyCart({
      templateId: TEMPLATE_ID,
      templateName: 'Pacote',
      templateDefaultPrice: 1000,
      templateValidityMonths: 6,
      lines: [
        adhocLine({ procedureTypeId: PROC_A, sourceTemplateLineId: TEMPLATE_LINE_ID }),
        adhocLine({ procedureTypeId: PROC_A, procedureTypeName: 'Botox extra', sourceTemplateLineId: null }),
      ],
    })
    const result = encounterCartSchema.safeParse(cart)
    expect(result.success).toBe(true)
  })
})
