import { BusinessError } from '@/lib/errors'
import { reportSideEffectFailure } from '@/lib/observability'

export const CARD_PAYMENT_PENDING_MESSAGE =
  'Não foi possível registrar o pagamento. A cobrança ficou pendente.'

export function cardPaymentErrorMessage(
  error: unknown,
  report: { area: string; tenantId: string },
): string {
  if (error instanceof BusinessError) return error.message
  reportSideEffectFailure(error, {
    area: report.area,
    step: 'card-payment',
    extra: { tenantId: report.tenantId },
  })
  return CARD_PAYMENT_PENDING_MESSAGE
}
