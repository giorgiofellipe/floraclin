import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  createFinancialEntrySchema,
  recordPaymentSchema,
  renegotiateSchema,
  bulkPaySchema,
  bulkCancelSchema,
  bulkUncancelSchema,
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

describe('recordPaymentSchema', () => {
  const validData = {
    installmentId: UUID,
    expectedTotalDue: 150,
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

  it('fails when amount exceeds what payment_records.amount can hold', () => {
    const result = recordPaymentSchema.safeParse({ ...validData, amount: 100_000_000 })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0].message).toBe('Valor acima do limite permitido')
    }
  })

  // Allocation rounds to cents with round2 while persistence rounds with
  // toFixed(2), and the two disagree on some half cents, so a fractional cent
  // would credit one figure and record another.
  it('rejects an amount with more than two decimals', () => {
    for (const amount of [0.001, 2.675, 1.005]) {
      const result = recordPaymentSchema.safeParse({ ...validData, amount })
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.issues.map((i) => i.message)).toContain(
          'Valor deve ter no máximo duas casas decimais',
        )
      }
    }
  })

  it('accepts an amount with exactly two decimals', () => {
    expect(recordPaymentSchema.safeParse({ ...validData, amount: 2.67 }).success).toBe(true)
    expect(recordPaymentSchema.safeParse({ ...validData, amount: 0.01 }).success).toBe(true)
  })

  it('accepts the maximum amount payment_records.amount can hold', () => {
    const result = recordPaymentSchema.safeParse({ ...validData, amount: 99_999_999.99 })
    expect(result.success).toBe(true)
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
      const card = paymentMethod.endsWith('_card') ? { terminalId: UUID2, installmentCount: 1, expectedRate: 1.5 } : undefined
      const result = recordPaymentSchema.safeParse({ ...validData, paymentMethod, card })
      expect(result.success).toBe(true)
    }
  })

  // The dialog sends the total it prefilled from, so the server can refuse a
  // write priced against a balance that has since changed.
  it('accepts expectedTotalDue with up to two decimals, including zero', () => {
    expect(recordPaymentSchema.safeParse({ ...validData, expectedTotalDue: 790.75 }).success).toBe(true)
    expect(recordPaymentSchema.safeParse({ ...validData, expectedTotalDue: 0 }).success).toBe(true)
  })

  it('requires expectedTotalDue', () => {
    const { expectedTotalDue: _omitted, ...withoutQuote } = validData
    void _omitted
    expect(recordPaymentSchema.safeParse(withoutQuote).success).toBe(false)
  })

  it('rejects expectedTotalDue with more than two decimals or below zero', () => {
    expect(recordPaymentSchema.safeParse({ ...validData, expectedTotalDue: 790.755 }).success).toBe(false)
    expect(recordPaymentSchema.safeParse({ ...validData, expectedTotalDue: -1 }).success).toBe(false)
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

  it.each(['newTotalAmount', 'waiveAmount'])('rejects a %s with a fractional cent', (field) => {
    const result = renegotiateSchema.safeParse({ ...validData, [field]: 769.995 })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.map((i) => i.message)).toContain(
        'Valor deve ter no máximo duas casas decimais',
      )
    }
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
      const card = paymentMethod.endsWith('_card') ? { terminalId: UUID2, installmentCount: 1, expectedRate: 1.5 } : undefined
      const result = bulkPaySchema.safeParse({ ...validData, paymentMethod, card })
      expect(result.success).toBe(true)
    }
  })

  it('passes with single installmentId', () => {
    const result = bulkPaySchema.safeParse({ ...validData, installmentIds: [UUID] })
    expect(result.success).toBe(true)
  })
})

describe.each([
  ['bulkCancelSchema', bulkCancelSchema],
  ['bulkUncancelSchema', bulkUncancelSchema],
])('%s', (_name, schema) => {
  const validData = {
    entryIds: [UUID, UUID2],
    reason: 'Paciente desistiu do tratamento',
  }

  it('passes with valid data', () => {
    expect(schema.safeParse(validData).success).toBe(true)
  })

  it('passes with single entryId', () => {
    expect(schema.safeParse({ ...validData, entryIds: [UUID] }).success).toBe(true)
  })

  it.each([
    ['entryIds is empty', { entryIds: [] }],
    ['entryIds contains invalid uuid', { entryIds: ['not-uuid'] }],
    ['reason is missing', { reason: undefined }],
    ['reason is empty', { reason: '' }],
  ])('fails when %s', (_label, overrides) => {
    expect(schema.safeParse({ ...validData, ...overrides }).success).toBe(false)
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

describe('paidAt bounds', () => {
  // 08:00 in BR on 2026-09-03.
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-03T11:00:00.000Z'))
  })
  afterEach(() => vi.useRealTimers())

  const record = (paidAt: string) =>
    recordPaymentSchema.safeParse({
      installmentId: '00000000-0000-4000-8000-000000000001',
      amount: 100,
      paymentMethod: 'pix',
      expectedTotalDue: 100,
      paidAt,
    }).success
  const bulk = (paidAt: string) =>
    bulkPaySchema.safeParse({
      installmentIds: ['00000000-0000-4000-8000-000000000001'],
      paymentMethod: 'pix',
      paidAt,
    }).success

  // BR noon of the current day is ahead of the wall clock every morning
  // before 12:00 in BR.
  it.each([
    ['BR noon of the current BR day', true, record, '2026-09-03T15:00:00.000Z'],
    ['the last instant of the current BR day', true, record, '2026-09-04T02:59:59.999Z'],
    ['the first instant of the next BR day', false, record, '2026-09-04T03:00:00.000Z'],
    ['the next BR day on the bulk schema', false, bulk, '2026-09-04T03:00:00.000Z'],
  ])('%s: accepted is %s', (_label, accepted, parse, paidAt) => {
    expect(parse(paidAt)).toBe(accepted)
  })
})

describe('card payment fields', () => {
  const card = { terminalId: UUID2, installmentCount: 6, expectedRate: 8.99 }
  const entry = { patientId: UUID, description: 'x', totalAmount: 500, installmentCount: 1 }
  const payment = { installmentId: UUID, expectedTotalDue: 150, amount: 150 }
  const bulk = { installmentIds: [UUID] }

  it.each([
    ['recordPaymentSchema', recordPaymentSchema, payment],
    ['bulkPaySchema', bulkPaySchema, bulk],
    ['createFinancialEntrySchema', createFinancialEntrySchema, entry],
  ] as const)('%s asks for the maquininha when the method is a card and none is sent', (_name, schema, base) => {
    for (const paymentMethod of ['credit_card', 'debit_card']) {
      const result = (schema as typeof recordPaymentSchema).safeParse({ ...base, paymentMethod })
      expect(result.success).toBe(false)
      expect(result.error?.issues.map((i) => i.message)).toContain('Selecione a maquininha')
    }
  })

  it.each([
    ['recordPaymentSchema', recordPaymentSchema, payment],
    ['bulkPaySchema', bulkPaySchema, bulk],
    ['createFinancialEntrySchema', createFinancialEntrySchema, entry],
  ] as const)('%s accepts a card method with the maquininha and a non-card method without it', (_name, schema, base) => {
    const s = schema as typeof recordPaymentSchema
    expect(s.safeParse({ ...base, paymentMethod: 'credit_card', card }).success).toBe(true)
    expect(s.safeParse({ ...base, paymentMethod: 'pix' }).success).toBe(true)
    expect(s.safeParse({ ...base, paymentMethod: 'pix', card }).success).toBe(false)
  })

  it.each([
    ['recordPaymentSchema', recordPaymentSchema, payment],
    ['bulkPaySchema', bulkPaySchema, bulk],
    ['createFinancialEntrySchema', createFinancialEntrySchema, entry],
  ] as const)('%s refuses a card without the expected rate, or with a fractional or out of range one', (_name, schema, base) => {
    const s = schema as typeof recordPaymentSchema
    const withCard = (c: Record<string, unknown>) => s.safeParse({ ...base, paymentMethod: 'credit_card', card: c })
    const { expectedRate: _omitted, ...noRate } = card
    expect(withCard(noRate).success).toBe(false)
    expect(withCard({ ...card, expectedRate: 8.995 }).success).toBe(false)
    expect(withCard({ ...card, expectedRate: 101 }).success).toBe(false)
    expect(withCard({ ...card, expectedRate: -1 }).success).toBe(false)
  })

  it('a card charge with 3 patient installments is refused', () => {
    const result = createFinancialEntrySchema.safeParse({
      ...entry,
      installmentCount: 3,
      paymentMethod: 'credit_card',
      card,
    })
    expect(result.success).toBe(false)
    expect(result.error?.issues.map((i) => i.message)).toContain('Pagamento em cartão gera uma única parcela')
  })

  it.each([
    ['above the column limit', 100_000_000, 'Valor acima do limite permitido'],
    ['with a fractional cent', 10.005, 'Valor deve ter no máximo duas casas decimais'],
  ])('a charge total %s is refused', (_name, totalAmount, message) => {
    const result = createFinancialEntrySchema.safeParse({ ...entry, totalAmount })
    expect(result.success).toBe(false)
    expect(result.error?.issues.map((i) => i.message)).toContain(message)
  })
})
