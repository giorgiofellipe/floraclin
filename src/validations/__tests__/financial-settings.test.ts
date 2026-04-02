import { describe, it, expect } from 'vitest'
import { updateFinancialSettingsSchema } from '../financial-settings'

describe('updateFinancialSettingsSchema', () => {
  it('passes with no fields (all optional)', () => {
    const result = updateFinancialSettingsSchema.safeParse({})
    expect(result.success).toBe(true)
  })

  it('passes with all fields', () => {
    const result = updateFinancialSettingsSchema.safeParse({
      fineType: 'percentage',
      fineValue: 2,
      monthlyInterestPercent: 1,
      gracePeriodDays: 3,
      bankName: 'Banco do Brasil',
      bankAgency: '1234',
      bankAccount: '12345-6',
      pixKeyType: 'cpf',
      pixKey: '123.456.789-00',
      defaultInstallmentCount: 3,
      defaultPaymentMethod: 'pix',
    })
    expect(result.success).toBe(true)
  })

  // Fine type
  it('accepts percentage fine type', () => {
    const result = updateFinancialSettingsSchema.safeParse({ fineType: 'percentage' })
    expect(result.success).toBe(true)
  })

  it('accepts fixed fine type', () => {
    const result = updateFinancialSettingsSchema.safeParse({ fineType: 'fixed' })
    expect(result.success).toBe(true)
  })

  it('fails with invalid fine type', () => {
    const result = updateFinancialSettingsSchema.safeParse({ fineType: 'variable' })
    expect(result.success).toBe(false)
  })

  // Fine value - legal cap enforcement
  it('passes with fineValue of 0', () => {
    const result = updateFinancialSettingsSchema.safeParse({ fineValue: 0 })
    expect(result.success).toBe(true)
  })

  it('passes with fineValue of 2 (max legal)', () => {
    const result = updateFinancialSettingsSchema.safeParse({ fineValue: 2 })
    expect(result.success).toBe(true)
  })

  it('passes with fineValue of 1.5', () => {
    const result = updateFinancialSettingsSchema.safeParse({ fineValue: 1.5 })
    expect(result.success).toBe(true)
  })

  it('fails with fineValue of 2.01 (exceeds legal cap)', () => {
    const result = updateFinancialSettingsSchema.safeParse({ fineValue: 2.01 })
    expect(result.success).toBe(false)
  })

  it('fails with fineValue of 5 (exceeds legal cap)', () => {
    const result = updateFinancialSettingsSchema.safeParse({ fineValue: 5 })
    expect(result.success).toBe(false)
  })

  it('fails with negative fineValue', () => {
    const result = updateFinancialSettingsSchema.safeParse({ fineValue: -1 })
    expect(result.success).toBe(false)
  })

  // Monthly interest - legal cap enforcement
  it('passes with monthlyInterestPercent of 0', () => {
    const result = updateFinancialSettingsSchema.safeParse({ monthlyInterestPercent: 0 })
    expect(result.success).toBe(true)
  })

  it('passes with monthlyInterestPercent of 1 (max legal)', () => {
    const result = updateFinancialSettingsSchema.safeParse({ monthlyInterestPercent: 1 })
    expect(result.success).toBe(true)
  })

  it('passes with monthlyInterestPercent of 0.5', () => {
    const result = updateFinancialSettingsSchema.safeParse({ monthlyInterestPercent: 0.5 })
    expect(result.success).toBe(true)
  })

  it('fails with monthlyInterestPercent of 1.01 (exceeds legal cap)', () => {
    const result = updateFinancialSettingsSchema.safeParse({ monthlyInterestPercent: 1.01 })
    expect(result.success).toBe(false)
  })

  it('fails with monthlyInterestPercent of 3 (exceeds legal cap)', () => {
    const result = updateFinancialSettingsSchema.safeParse({ monthlyInterestPercent: 3 })
    expect(result.success).toBe(false)
  })

  it('fails with negative monthlyInterestPercent', () => {
    const result = updateFinancialSettingsSchema.safeParse({ monthlyInterestPercent: -0.5 })
    expect(result.success).toBe(false)
  })

  // Grace period
  it('passes with gracePeriodDays of 0', () => {
    const result = updateFinancialSettingsSchema.safeParse({ gracePeriodDays: 0 })
    expect(result.success).toBe(true)
  })

  it('passes with gracePeriodDays of 30', () => {
    const result = updateFinancialSettingsSchema.safeParse({ gracePeriodDays: 30 })
    expect(result.success).toBe(true)
  })

  it('fails with gracePeriodDays of 31', () => {
    const result = updateFinancialSettingsSchema.safeParse({ gracePeriodDays: 31 })
    expect(result.success).toBe(false)
  })

  it('fails with negative gracePeriodDays', () => {
    const result = updateFinancialSettingsSchema.safeParse({ gracePeriodDays: -1 })
    expect(result.success).toBe(false)
  })

  it('fails with non-integer gracePeriodDays', () => {
    const result = updateFinancialSettingsSchema.safeParse({ gracePeriodDays: 2.5 })
    expect(result.success).toBe(false)
  })

  // PIX key types
  it('accepts all valid pix key types', () => {
    const types = ['cpf', 'cnpj', 'email', 'phone', 'random']
    for (const pixKeyType of types) {
      const result = updateFinancialSettingsSchema.safeParse({ pixKeyType })
      expect(result.success).toBe(true)
    }
  })

  it('fails with invalid pix key type', () => {
    const result = updateFinancialSettingsSchema.safeParse({ pixKeyType: 'bitcoin_address' })
    expect(result.success).toBe(false)
  })

  it('accepts null for pixKeyType', () => {
    const result = updateFinancialSettingsSchema.safeParse({ pixKeyType: null })
    expect(result.success).toBe(true)
  })

  it('accepts null for pixKey', () => {
    const result = updateFinancialSettingsSchema.safeParse({ pixKey: null })
    expect(result.success).toBe(true)
  })

  // Bank fields - nullable
  it('accepts null for bankName', () => {
    const result = updateFinancialSettingsSchema.safeParse({ bankName: null })
    expect(result.success).toBe(true)
  })

  it('accepts null for bankAgency', () => {
    const result = updateFinancialSettingsSchema.safeParse({ bankAgency: null })
    expect(result.success).toBe(true)
  })

  it('accepts null for bankAccount', () => {
    const result = updateFinancialSettingsSchema.safeParse({ bankAccount: null })
    expect(result.success).toBe(true)
  })

  it('fails when bankName exceeds 100 characters', () => {
    const result = updateFinancialSettingsSchema.safeParse({ bankName: 'a'.repeat(101) })
    expect(result.success).toBe(false)
  })

  it('fails when bankAgency exceeds 20 characters', () => {
    const result = updateFinancialSettingsSchema.safeParse({ bankAgency: 'a'.repeat(21) })
    expect(result.success).toBe(false)
  })

  it('fails when bankAccount exceeds 30 characters', () => {
    const result = updateFinancialSettingsSchema.safeParse({ bankAccount: 'a'.repeat(31) })
    expect(result.success).toBe(false)
  })

  it('fails when pixKey exceeds 100 characters', () => {
    const result = updateFinancialSettingsSchema.safeParse({ pixKey: 'a'.repeat(101) })
    expect(result.success).toBe(false)
  })

  // Default installment count
  it('passes with defaultInstallmentCount of 1', () => {
    const result = updateFinancialSettingsSchema.safeParse({ defaultInstallmentCount: 1 })
    expect(result.success).toBe(true)
  })

  it('passes with defaultInstallmentCount of 12', () => {
    const result = updateFinancialSettingsSchema.safeParse({ defaultInstallmentCount: 12 })
    expect(result.success).toBe(true)
  })

  it('fails with defaultInstallmentCount of 0', () => {
    const result = updateFinancialSettingsSchema.safeParse({ defaultInstallmentCount: 0 })
    expect(result.success).toBe(false)
  })

  it('fails with defaultInstallmentCount of 13', () => {
    const result = updateFinancialSettingsSchema.safeParse({ defaultInstallmentCount: 13 })
    expect(result.success).toBe(false)
  })

  it('fails with non-integer defaultInstallmentCount', () => {
    const result = updateFinancialSettingsSchema.safeParse({ defaultInstallmentCount: 2.5 })
    expect(result.success).toBe(false)
  })

  // Default payment method
  it('accepts all valid default payment methods', () => {
    const methods = ['pix', 'credit_card', 'debit_card', 'cash', 'transfer']
    for (const defaultPaymentMethod of methods) {
      const result = updateFinancialSettingsSchema.safeParse({ defaultPaymentMethod })
      expect(result.success).toBe(true)
    }
  })

  it('fails with invalid default payment method', () => {
    const result = updateFinancialSettingsSchema.safeParse({ defaultPaymentMethod: 'bitcoin' })
    expect(result.success).toBe(false)
  })

  it('accepts null for defaultPaymentMethod', () => {
    const result = updateFinancialSettingsSchema.safeParse({ defaultPaymentMethod: null })
    expect(result.success).toBe(true)
  })
})
