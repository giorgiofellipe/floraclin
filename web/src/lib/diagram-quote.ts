import type { QuotationLine } from '@/validations/face-diagram-group'
import type { EncounterCart } from '@/validations/encounter-cart'

export function quoteTotal(lines: QuotationLine[]): number {
  const cents = lines.reduce((sum, l) => sum + Math.round(l.unitPrice * 100) * l.sessions, 0)
  return cents / 100
}

export function buildCartFromQuote(lines: QuotationLine[]): EncounterCart {
  return {
    templateId: null,
    templateName: null,
    templateDefaultPrice: null,
    templateValidityMonths: null,
    lines: lines.map((l) => ({
      procedureTypeId: l.procedureTypeId,
      procedureTypeName: l.procedureTypeName,
      sessions: l.sessions,
      defaultPrice: l.unitPrice,
      sourceTemplateLineId: null,
    })),
    totalOverride: null,
  }
}
