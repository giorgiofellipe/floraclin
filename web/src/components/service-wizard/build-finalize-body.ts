import type { EncounterCart } from '@/validations/encounter-cart'
import type { CardPaymentChoice } from './types'

interface FinancialPlanRaw {
  totalAmount?: number | string
  installmentCount?: number
  paymentMethod?: string
  notes?: string
}

export function buildFinalizeBody(input: {
  cart: EncounterCart
  draftRecordIds: string[]
  patientId: string
  practitionerId: string
  financialPlan: FinancialPlanRaw
  card: CardPaymentChoice
}) {
  const { financialPlan: plan, card } = input
  return {
    cart: input.cart,
    draftRecordIds: input.draftRecordIds,
    patientId: input.patientId,
    practitionerId: input.practitionerId,
    financialPlan: {
      totalAmount: String(plan.totalAmount ?? ''),
      installmentCount: Number(plan.installmentCount ?? 1),
      paymentMethod: String(plan.paymentMethod ?? ''),
      notes: plan.notes,
    },
    ...(card.cardNow && card.terminalId && card.expectedRate !== null
      ? { cardPayment: { terminalId: card.terminalId, expectedRate: card.expectedRate } }
      : {}),
    consents: [],
  }
}
