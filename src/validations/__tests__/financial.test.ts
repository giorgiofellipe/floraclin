import { describe, it, expect } from 'vitest'
import { createFinancialEntrySchema, payInstallmentSchema } from '../financial'

describe('createFinancialEntrySchema', () => {
  const validData = {
    patientId: '550e8400-e29b-41d4-a716-446655440000',
    description: 'Aplicacao de Botox',
    totalAmount: 500,
    installmentCount: 3,
  }

  it('passes with valid data', () => {
    const result = createFinancialEntrySchema.safeParse(validData)
    expect(result.success).toBe(true)
  })

  it('passes with optional procedure and appointment ids', () => {
    const result = createFinancialEntrySchema.safeParse({
      ...validData,
      procedureRecordId: '550e8400-e29b-41d4-a716-446655440001',
      appointmentId: '550e8400-e29b-41d4-a716-446655440002',
      notes: 'Parcelado em 3x',
    })
    expect(result.success).toBe(true)
  })

  it('fails when patientId is missing', () => {
    const { patientId, ...rest } = validData
    const result = createFinancialEntrySchema.safeParse(rest)
    expect(result.success).toBe(false)
  })

  it('fails when description is empty', () => {
    const result = createFinancialEntrySchema.safeParse({ ...validData, description: '' })
    expect(result.success).toBe(false)
  })

  it('fails when totalAmount is zero', () => {
    const result = createFinancialEntrySchema.safeParse({ ...validData, totalAmount: 0 })
    expect(result.success).toBe(false)
  })

  it('fails when totalAmount is negative', () => {
    const result = createFinancialEntrySchema.safeParse({ ...validData, totalAmount: -100 })
    expect(result.success).toBe(false)
  })

  it('fails when installmentCount is zero', () => {
    const result = createFinancialEntrySchema.safeParse({ ...validData, installmentCount: 0 })
    expect(result.success).toBe(false)
  })

  it('fails when installmentCount exceeds 12', () => {
    const result = createFinancialEntrySchema.safeParse({ ...validData, installmentCount: 13 })
    expect(result.success).toBe(false)
  })

  it('passes with installmentCount of 1', () => {
    const result = createFinancialEntrySchema.safeParse({ ...validData, installmentCount: 1 })
    expect(result.success).toBe(true)
  })

  it('passes with installmentCount of 12', () => {
    const result = createFinancialEntrySchema.safeParse({ ...validData, installmentCount: 12 })
    expect(result.success).toBe(true)
  })

  it('fails with non-integer installmentCount', () => {
    const result = createFinancialEntrySchema.safeParse({ ...validData, installmentCount: 2.5 })
    expect(result.success).toBe(false)
  })
})

describe('payInstallmentSchema', () => {
  it('passes with valid payment method', () => {
    const result = payInstallmentSchema.safeParse({
      installmentId: '550e8400-e29b-41d4-a716-446655440000',
      paymentMethod: 'pix',
    })
    expect(result.success).toBe(true)
  })

  it('accepts all valid payment methods', () => {
    const methods = ['pix', 'credit_card', 'debit_card', 'cash', 'transfer']
    for (const paymentMethod of methods) {
      const result = payInstallmentSchema.safeParse({
        installmentId: '550e8400-e29b-41d4-a716-446655440000',
        paymentMethod,
      })
      expect(result.success).toBe(true)
    }
  })

  it('fails with invalid payment method', () => {
    const result = payInstallmentSchema.safeParse({
      installmentId: '550e8400-e29b-41d4-a716-446655440000',
      paymentMethod: 'bitcoin',
    })
    expect(result.success).toBe(false)
  })

  it('fails with invalid installmentId', () => {
    const result = payInstallmentSchema.safeParse({
      installmentId: 'not-uuid',
      paymentMethod: 'pix',
    })
    expect(result.success).toBe(false)
  })
})
