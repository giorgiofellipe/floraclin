import { describe, it, expect } from 'vitest'
import {
  createFinancialEntrySchema,
  payInstallmentSchema,
  recordPaymentSchema,
  renegotiateSchema,
  bulkPaySchema,
  bulkCancelSchema,
  ledgerFilterSchema,
  financialFilterSchema,
} from '../financial'

const UUID = '550e8400-e29b-41d4-a716-446655440000'
const UUID2 = '550e8400-e29b-41d4-a716-446655440001'

describe('createFinancialEntrySchema', () => {
  const validData = {
    patientId: UUID,
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
      procedureRecordId: UUID2,
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
      installmentId: UUID,
      paymentMethod: 'pix',
    })
    expect(result.success).toBe(true)
  })

  it('accepts all valid payment methods', () => {
    const methods = ['pix', 'credit_card', 'debit_card', 'cash', 'transfer']
    for (const paymentMethod of methods) {
      const result = payInstallmentSchema.safeParse({
        installmentId: UUID,
        paymentMethod,
      })
      expect(result.success).toBe(true)
    }
  })

  it('fails with invalid payment method', () => {
    const result = payInstallmentSchema.safeParse({
      installmentId: UUID,
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

describe('recordPaymentSchema', () => {
  const validData = {
    installmentId: UUID,
    amount: 150.50,
    paymentMethod: 'pix' as const,
  }

  it('passes with valid data', () => {
    const result = recordPaymentSchema.safeParse(validData)
    expect(result.success).toBe(true)
  })

  it('passes with optional paidAt and notes', () => {
    const result = recordPaymentSchema.safeParse({
      ...validData,
      paidAt: '2026-03-15T10:00:00-03:00',
      notes: 'Pagamento parcial',
    })
    expect(result.success).toBe(true)
  })

  it('fails when installmentId is missing', () => {
    const { installmentId, ...rest } = validData
    const result = recordPaymentSchema.safeParse(rest)
    expect(result.success).toBe(false)
  })

  it('fails when amount is missing', () => {
    const { amount, ...rest } = validData
    const result = recordPaymentSchema.safeParse(rest)
    expect(result.success).toBe(false)
  })

  it('fails when amount is zero', () => {
    const result = recordPaymentSchema.safeParse({ ...validData, amount: 0 })
    expect(result.success).toBe(false)
  })

  it('fails when amount is negative', () => {
    const result = recordPaymentSchema.safeParse({ ...validData, amount: -50 })
    expect(result.success).toBe(false)
  })

  it('fails when paymentMethod is missing', () => {
    const { paymentMethod, ...rest } = validData
    const result = recordPaymentSchema.safeParse(rest)
    expect(result.success).toBe(false)
  })

  it('fails with invalid paymentMethod', () => {
    const result = recordPaymentSchema.safeParse({ ...validData, paymentMethod: 'bitcoin' })
    expect(result.success).toBe(false)
  })

  it('fails with invalid installmentId', () => {
    const result = recordPaymentSchema.safeParse({ ...validData, installmentId: 'not-uuid' })
    expect(result.success).toBe(false)
  })

  it('fails with invalid paidAt format', () => {
    const result = recordPaymentSchema.safeParse({ ...validData, paidAt: 'not-a-date' })
    expect(result.success).toBe(false)
  })

  it('accepts all valid payment methods', () => {
    const methods = ['pix', 'credit_card', 'debit_card', 'cash', 'transfer']
    for (const paymentMethod of methods) {
      const result = recordPaymentSchema.safeParse({ ...validData, paymentMethod })
      expect(result.success).toBe(true)
    }
  })
})

describe('renegotiateSchema', () => {
  const validData = {
    entryIds: [UUID],
    newInstallmentCount: 6,
    description: 'Renegociacao - Paciente X',
  }

  it('passes with valid data', () => {
    const result = renegotiateSchema.safeParse(validData)
    expect(result.success).toBe(true)
  })

  it('passes with multiple entryIds', () => {
    const result = renegotiateSchema.safeParse({
      ...validData,
      entryIds: [UUID, UUID2],
    })
    expect(result.success).toBe(true)
  })

  it('passes with waivePenalties and waiveAmount', () => {
    const result = renegotiateSchema.safeParse({
      ...validData,
      waivePenalties: true,
      waiveAmount: 50,
    })
    expect(result.success).toBe(true)
  })

  it('defaults waivePenalties to false', () => {
    const result = renegotiateSchema.safeParse(validData)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.waivePenalties).toBe(false)
    }
  })

  it('defaults waiveAmount to 0', () => {
    const result = renegotiateSchema.safeParse(validData)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.waiveAmount).toBe(0)
    }
  })

  it('fails when entryIds is empty', () => {
    const result = renegotiateSchema.safeParse({ ...validData, entryIds: [] })
    expect(result.success).toBe(false)
  })

  it('fails when entryIds contains invalid uuid', () => {
    const result = renegotiateSchema.safeParse({ ...validData, entryIds: ['not-uuid'] })
    expect(result.success).toBe(false)
  })

  it('fails when newInstallmentCount is missing', () => {
    const { newInstallmentCount, ...rest } = validData
    const result = renegotiateSchema.safeParse(rest)
    expect(result.success).toBe(false)
  })

  it('fails when newInstallmentCount is 0', () => {
    const result = renegotiateSchema.safeParse({ ...validData, newInstallmentCount: 0 })
    expect(result.success).toBe(false)
  })

  it('fails when newInstallmentCount exceeds 24', () => {
    const result = renegotiateSchema.safeParse({ ...validData, newInstallmentCount: 25 })
    expect(result.success).toBe(false)
  })

  it('passes with newInstallmentCount of 24', () => {
    const result = renegotiateSchema.safeParse({ ...validData, newInstallmentCount: 24 })
    expect(result.success).toBe(true)
  })

  it('fails when description is empty', () => {
    const result = renegotiateSchema.safeParse({ ...validData, description: '' })
    expect(result.success).toBe(false)
  })

  it('fails when waiveAmount is negative', () => {
    const result = renegotiateSchema.safeParse({ ...validData, waiveAmount: -10 })
    expect(result.success).toBe(false)
  })

  it('fails with non-integer newInstallmentCount', () => {
    const result = renegotiateSchema.safeParse({ ...validData, newInstallmentCount: 3.5 })
    expect(result.success).toBe(false)
  })
})

describe('bulkPaySchema', () => {
  const validData = {
    installmentIds: [UUID, UUID2],
    paymentMethod: 'pix' as const,
  }

  it('passes with valid data', () => {
    const result = bulkPaySchema.safeParse(validData)
    expect(result.success).toBe(true)
  })

  it('passes with optional paidAt', () => {
    const result = bulkPaySchema.safeParse({
      ...validData,
      paidAt: '2026-03-15T10:00:00-03:00',
    })
    expect(result.success).toBe(true)
  })

  it('fails when installmentIds is empty', () => {
    const result = bulkPaySchema.safeParse({ ...validData, installmentIds: [] })
    expect(result.success).toBe(false)
  })

  it('fails when installmentIds contains invalid uuid', () => {
    const result = bulkPaySchema.safeParse({ ...validData, installmentIds: ['not-uuid'] })
    expect(result.success).toBe(false)
  })

  it('fails when paymentMethod is missing', () => {
    const { paymentMethod, ...rest } = validData
    const result = bulkPaySchema.safeParse(rest)
    expect(result.success).toBe(false)
  })

  it('fails with invalid paymentMethod', () => {
    const result = bulkPaySchema.safeParse({ ...validData, paymentMethod: 'bitcoin' })
    expect(result.success).toBe(false)
  })

  it('fails with invalid paidAt format', () => {
    const result = bulkPaySchema.safeParse({ ...validData, paidAt: 'yesterday' })
    expect(result.success).toBe(false)
  })

  it('accepts all valid payment methods', () => {
    const methods = ['pix', 'credit_card', 'debit_card', 'cash', 'transfer']
    for (const paymentMethod of methods) {
      const result = bulkPaySchema.safeParse({ ...validData, paymentMethod })
      expect(result.success).toBe(true)
    }
  })

  it('passes with single installmentId', () => {
    const result = bulkPaySchema.safeParse({ ...validData, installmentIds: [UUID] })
    expect(result.success).toBe(true)
  })
})

describe('bulkCancelSchema', () => {
  const validData = {
    entryIds: [UUID, UUID2],
    reason: 'Paciente desistiu do tratamento',
  }

  it('passes with valid data', () => {
    const result = bulkCancelSchema.safeParse(validData)
    expect(result.success).toBe(true)
  })

  it('fails when entryIds is empty', () => {
    const result = bulkCancelSchema.safeParse({ ...validData, entryIds: [] })
    expect(result.success).toBe(false)
  })

  it('fails when entryIds contains invalid uuid', () => {
    const result = bulkCancelSchema.safeParse({ ...validData, entryIds: ['not-uuid'] })
    expect(result.success).toBe(false)
  })

  it('fails when reason is missing', () => {
    const { reason, ...rest } = validData
    const result = bulkCancelSchema.safeParse(rest)
    expect(result.success).toBe(false)
  })

  it('fails when reason is empty', () => {
    const result = bulkCancelSchema.safeParse({ ...validData, reason: '' })
    expect(result.success).toBe(false)
  })

  it('passes with single entryId', () => {
    const result = bulkCancelSchema.safeParse({ ...validData, entryIds: [UUID] })
    expect(result.success).toBe(true)
  })
})

describe('ledgerFilterSchema', () => {
  const validData = {
    dateFrom: '2026-01-01',
    dateTo: '2026-03-31',
  }

  it('passes with required fields only', () => {
    const result = ledgerFilterSchema.safeParse(validData)
    expect(result.success).toBe(true)
  })

  it('defaults type to all', () => {
    const result = ledgerFilterSchema.safeParse(validData)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.type).toBe('all')
    }
  })

  it('defaults page to 1', () => {
    const result = ledgerFilterSchema.safeParse(validData)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.page).toBe(1)
    }
  })

  it('defaults limit to 50', () => {
    const result = ledgerFilterSchema.safeParse(validData)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.limit).toBe(50)
    }
  })

  it('passes with all optional fields', () => {
    const result = ledgerFilterSchema.safeParse({
      ...validData,
      type: 'inflow',
      paymentMethod: 'pix',
      patientId: UUID,
      categoryId: UUID2,
      page: 2,
      limit: 25,
    })
    expect(result.success).toBe(true)
  })

  it('accepts inflow type', () => {
    const result = ledgerFilterSchema.safeParse({ ...validData, type: 'inflow' })
    expect(result.success).toBe(true)
  })

  it('accepts outflow type', () => {
    const result = ledgerFilterSchema.safeParse({ ...validData, type: 'outflow' })
    expect(result.success).toBe(true)
  })

  it('fails with invalid type', () => {
    const result = ledgerFilterSchema.safeParse({ ...validData, type: 'invalid' })
    expect(result.success).toBe(false)
  })

  it('fails when dateFrom is missing', () => {
    const { dateFrom, ...rest } = validData
    const result = ledgerFilterSchema.safeParse(rest)
    expect(result.success).toBe(false)
  })

  it('fails when dateTo is missing', () => {
    const { dateTo, ...rest } = validData
    const result = ledgerFilterSchema.safeParse(rest)
    expect(result.success).toBe(false)
  })

  it('fails when dateFrom is empty', () => {
    const result = ledgerFilterSchema.safeParse({ ...validData, dateFrom: '' })
    expect(result.success).toBe(false)
  })

  it('fails when dateTo is empty', () => {
    const result = ledgerFilterSchema.safeParse({ ...validData, dateTo: '' })
    expect(result.success).toBe(false)
  })

  it('fails with invalid paymentMethod', () => {
    const result = ledgerFilterSchema.safeParse({ ...validData, paymentMethod: 'bitcoin' })
    expect(result.success).toBe(false)
  })

  it('fails with invalid patientId', () => {
    const result = ledgerFilterSchema.safeParse({ ...validData, patientId: 'not-uuid' })
    expect(result.success).toBe(false)
  })

  it('fails when limit exceeds 100', () => {
    const result = ledgerFilterSchema.safeParse({ ...validData, limit: 101 })
    expect(result.success).toBe(false)
  })
})

describe('financialFilterSchema', () => {
  it('passes with no fields (all optional)', () => {
    const result = financialFilterSchema.safeParse({})
    expect(result.success).toBe(true)
  })

  it('accepts isOverdue filter', () => {
    const result = financialFilterSchema.safeParse({ isOverdue: true })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.isOverdue).toBe(true)
    }
  })

  it('accepts isPartial filter', () => {
    const result = financialFilterSchema.safeParse({ isPartial: true })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.isPartial).toBe(true)
    }
  })

  it('accepts paymentMethod filter', () => {
    const result = financialFilterSchema.safeParse({ paymentMethod: 'credit_card' })
    expect(result.success).toBe(true)
  })

  it('accepts renegotiated status', () => {
    const result = financialFilterSchema.safeParse({ status: 'renegotiated' })
    expect(result.success).toBe(true)
  })

  it('fails with invalid paymentMethod', () => {
    const result = financialFilterSchema.safeParse({ paymentMethod: 'bitcoin' })
    expect(result.success).toBe(false)
  })

  it('fails with invalid status', () => {
    const result = financialFilterSchema.safeParse({ status: 'unknown' })
    expect(result.success).toBe(false)
  })

  it('defaults page to 1', () => {
    const result = financialFilterSchema.safeParse({})
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.page).toBe(1)
    }
  })

  it('defaults limit to 20', () => {
    const result = financialFilterSchema.safeParse({})
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.limit).toBe(20)
    }
  })
})
