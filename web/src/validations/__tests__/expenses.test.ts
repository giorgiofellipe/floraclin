import { describe, it, expect } from 'vitest'
import {
  createExpenseSchema,
  payExpenseInstallmentSchema,
  expenseFilterSchema,
  expenseCategorySchema,
} from '../expenses'

const UUID = '550e8400-e29b-41d4-a716-446655440000'

describe('createExpenseSchema', () => {
  const validData = {
    categoryId: UUID,
    description: 'Aluguel do consultorio',
    totalAmount: 3000,
    installmentCount: 1,
  }

  it('passes with valid data', () => {
    const result = createExpenseSchema.safeParse(validData)
    expect(result.success).toBe(true)
  })

  it('passes with optional notes', () => {
    const result = createExpenseSchema.safeParse({
      ...validData,
      notes: 'Referente a marco/2026',
    })
    expect(result.success).toBe(true)
  })

  it('passes with customDueDates', () => {
    const result = createExpenseSchema.safeParse({
      ...validData,
      installmentCount: 3,
      customDueDates: ['2026-04-01', '2026-05-01', '2026-06-01'],
    })
    expect(result.success).toBe(true)
  })

  it('fails when categoryId is missing', () => {
    const { categoryId, ...rest } = validData
    const result = createExpenseSchema.safeParse(rest)
    expect(result.success).toBe(false)
  })

  it('fails when categoryId is invalid uuid', () => {
    const result = createExpenseSchema.safeParse({ ...validData, categoryId: 'not-uuid' })
    expect(result.success).toBe(false)
  })

  it('fails when description is missing', () => {
    const { description, ...rest } = validData
    const result = createExpenseSchema.safeParse(rest)
    expect(result.success).toBe(false)
  })

  it('fails when description is empty', () => {
    const result = createExpenseSchema.safeParse({ ...validData, description: '' })
    expect(result.success).toBe(false)
  })

  it('fails when totalAmount is missing', () => {
    const { totalAmount, ...rest } = validData
    const result = createExpenseSchema.safeParse(rest)
    expect(result.success).toBe(false)
  })

  it('fails when totalAmount is zero', () => {
    const result = createExpenseSchema.safeParse({ ...validData, totalAmount: 0 })
    expect(result.success).toBe(false)
  })

  it('fails when totalAmount is negative', () => {
    const result = createExpenseSchema.safeParse({ ...validData, totalAmount: -500 })
    expect(result.success).toBe(false)
  })

  it('fails when installmentCount is missing', () => {
    const { installmentCount, ...rest } = validData
    const result = createExpenseSchema.safeParse(rest)
    expect(result.success).toBe(false)
  })

  it('fails when installmentCount is zero', () => {
    const result = createExpenseSchema.safeParse({ ...validData, installmentCount: 0 })
    expect(result.success).toBe(false)
  })

  it('fails when installmentCount exceeds 24', () => {
    const result = createExpenseSchema.safeParse({ ...validData, installmentCount: 25 })
    expect(result.success).toBe(false)
  })

  it('passes with installmentCount of 24', () => {
    const result = createExpenseSchema.safeParse({ ...validData, installmentCount: 24 })
    expect(result.success).toBe(true)
  })

  it('fails with non-integer installmentCount', () => {
    const result = createExpenseSchema.safeParse({ ...validData, installmentCount: 2.5 })
    expect(result.success).toBe(false)
  })
})

describe('payExpenseInstallmentSchema', () => {
  const validData = {
    installmentId: UUID,
    paymentMethod: 'pix' as const,
  }

  it('passes with valid data', () => {
    const result = payExpenseInstallmentSchema.safeParse(validData)
    expect(result.success).toBe(true)
  })

  it('passes with optional paidAt', () => {
    const result = payExpenseInstallmentSchema.safeParse({
      ...validData,
      paidAt: '2026-03-15T10:00:00-03:00',
    })
    expect(result.success).toBe(true)
  })

  it('fails when installmentId is missing', () => {
    const { installmentId, ...rest } = validData
    const result = payExpenseInstallmentSchema.safeParse(rest)
    expect(result.success).toBe(false)
  })

  it('fails when installmentId is invalid uuid', () => {
    const result = payExpenseInstallmentSchema.safeParse({ ...validData, installmentId: 'not-uuid' })
    expect(result.success).toBe(false)
  })

  it('fails when paymentMethod is missing', () => {
    const { paymentMethod, ...rest } = validData
    const result = payExpenseInstallmentSchema.safeParse(rest)
    expect(result.success).toBe(false)
  })

  it('fails with invalid paymentMethod', () => {
    const result = payExpenseInstallmentSchema.safeParse({ ...validData, paymentMethod: 'bitcoin' })
    expect(result.success).toBe(false)
  })

  it('fails with invalid paidAt format', () => {
    const result = payExpenseInstallmentSchema.safeParse({ ...validData, paidAt: 'not-a-date' })
    expect(result.success).toBe(false)
  })

  it('accepts all valid payment methods', () => {
    const methods = ['pix', 'credit_card', 'debit_card', 'cash', 'transfer']
    for (const paymentMethod of methods) {
      const result = payExpenseInstallmentSchema.safeParse({ ...validData, paymentMethod })
      expect(result.success).toBe(true)
    }
  })
})

describe('expenseFilterSchema', () => {
  it('passes with no fields (all optional)', () => {
    const result = expenseFilterSchema.safeParse({})
    expect(result.success).toBe(true)
  })

  it('passes with all fields', () => {
    const result = expenseFilterSchema.safeParse({
      status: 'pending',
      categoryId: UUID,
      isOverdue: true,
      paymentMethod: 'cash',
      dateFrom: '2026-01-01',
      dateTo: '2026-03-31',
      page: 2,
      limit: 50,
    })
    expect(result.success).toBe(true)
  })

  it('accepts pending status', () => {
    const result = expenseFilterSchema.safeParse({ status: 'pending' })
    expect(result.success).toBe(true)
  })

  it('accepts paid status', () => {
    const result = expenseFilterSchema.safeParse({ status: 'paid' })
    expect(result.success).toBe(true)
  })

  it('accepts cancelled status', () => {
    const result = expenseFilterSchema.safeParse({ status: 'cancelled' })
    expect(result.success).toBe(true)
  })

  it('fails with invalid status', () => {
    const result = expenseFilterSchema.safeParse({ status: 'overdue' })
    expect(result.success).toBe(false)
  })

  it('fails with invalid paymentMethod', () => {
    const result = expenseFilterSchema.safeParse({ paymentMethod: 'bitcoin' })
    expect(result.success).toBe(false)
  })

  it('fails with invalid categoryId', () => {
    const result = expenseFilterSchema.safeParse({ categoryId: 'not-uuid' })
    expect(result.success).toBe(false)
  })

  it('defaults page to 1', () => {
    const result = expenseFilterSchema.safeParse({})
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.page).toBe(1)
    }
  })

  it('defaults limit to 20', () => {
    const result = expenseFilterSchema.safeParse({})
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.limit).toBe(20)
    }
  })

  it('fails when limit exceeds 100', () => {
    const result = expenseFilterSchema.safeParse({ limit: 101 })
    expect(result.success).toBe(false)
  })
})

describe('expenseCategorySchema', () => {
  it('passes with valid data', () => {
    const result = expenseCategorySchema.safeParse({ name: 'Marketing' })
    expect(result.success).toBe(true)
  })

  it('defaults icon to circle', () => {
    const result = expenseCategorySchema.safeParse({ name: 'Marketing' })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.icon).toBe('circle')
    }
  })

  it('passes with custom icon', () => {
    const result = expenseCategorySchema.safeParse({ name: 'Marketing', icon: 'megaphone' })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.icon).toBe('megaphone')
    }
  })

  it('fails when name is missing', () => {
    const result = expenseCategorySchema.safeParse({})
    expect(result.success).toBe(false)
  })

  it('fails when name is empty', () => {
    const result = expenseCategorySchema.safeParse({ name: '' })
    expect(result.success).toBe(false)
  })

  it('fails when name exceeds 100 characters', () => {
    const result = expenseCategorySchema.safeParse({ name: 'a'.repeat(101) })
    expect(result.success).toBe(false)
  })

  it('passes with name at 100 characters', () => {
    const result = expenseCategorySchema.safeParse({ name: 'a'.repeat(100) })
    expect(result.success).toBe(true)
  })

  it('fails when icon exceeds 50 characters', () => {
    const result = expenseCategorySchema.safeParse({ name: 'Test', icon: 'a'.repeat(51) })
    expect(result.success).toBe(false)
  })
})
