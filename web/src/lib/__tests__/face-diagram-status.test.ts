import { describe, it, expect } from 'vitest'
import { deriveDiagramStatus } from '@/lib/face-diagram-status'
import { quotationLinesSchema } from '@/validations/face-diagram-group'
import type { ProcedureStatus } from '@/types'

const base = { isSessionGroup: false, declinedAt: null, hasQuotationLines: true }

describe('deriveDiagramStatus', () => {
  it('shows a standalone group with quotation lines as quote', () => {
    expect(deriveDiagramStatus({ ...base, procedureStatus: null })).toBe('quote')
  })

  it('shows a standalone group without quotation lines as a plain diagram', () => {
    expect(deriveDiagramStatus({ ...base, procedureStatus: null, hasQuotationLines: false })).toBe('diagram')
  })

  it('shows cancelled when the linked procedure is cancelled', () => {
    expect(deriveDiagramStatus({ ...base, procedureStatus: 'cancelled' })).toBe('cancelled')
  })

  it.each<ProcedureStatus>(['draft', 'planned', 'approved', 'in_progress'])(
    'shows in_service for procedure status %s',
    (procedureStatus) => {
      expect(deriveDiagramStatus({ ...base, procedureStatus })).toBe('in_service')
    },
  )

  it('shows applied when the procedure is completed', () => {
    expect(deriveDiagramStatus({ ...base, procedureStatus: 'completed' })).toBe('applied')
  })

  it('shows applied for session groups regardless of procedure status', () => {
    expect(deriveDiagramStatus({ ...base, isSessionGroup: true, procedureStatus: 'in_progress' })).toBe('applied')
  })

  it('shows declined when declinedAt is set, even for a procedure-less group', () => {
    expect(deriveDiagramStatus({ ...base, procedureStatus: null, declinedAt: new Date() })).toBe('declined')
  })
})

describe('quotationLinesSchema', () => {
  const line = { procedureTypeId: '11111111-1111-4111-8111-111111111111', procedureTypeName: 'Botox', sessions: 1, unitPrice: 100 }

  it('rejects the same procedure twice (a saved quote must load as a wizard cart)', () => {
    const result = quotationLinesSchema.safeParse([line, { ...line, sessions: 2 }])
    expect(result.success).toBe(false)
    expect(result.error?.issues[0].message).toBe('Procedimento repetido no orçamento')
  })

  it('rejects prices with more than two decimals', () => {
    expect(quotationLinesSchema.safeParse([{ ...line, unitPrice: 10.005 }]).success).toBe(false)
  })

  it('accepts a valid line with cents', () => {
    expect(quotationLinesSchema.safeParse([{ ...line, unitPrice: 333.33 }]).success).toBe(true)
  })
})
