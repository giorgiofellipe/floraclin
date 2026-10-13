import { and, eq } from 'drizzle-orm'
import { db } from '@/db/client'
import { installments } from '@/db/schema'
import {
  loadLivePayments,
  paymentDateAfterLivePayments,
  toInstallmentBase,
} from '@/db/queries/financial'
import { BusinessError } from '@/lib/errors'
import { quoteInstallment, type InstallmentQuote } from '@/lib/financial/penalties'

export interface InstallmentQuoteResult extends InstallmentQuote {
  asOf: string
}

/**
 * Read-only pricing for the payment dialog. The write path prices the row it
 * locked instead; both call the same `quoteInstallment`, which is what keeps
 * the prefilled amount and the amount the server accepts in agreement.
 */
export async function getInstallmentQuote(
  tenantId: string,
  installmentId: string,
  asOf: Date,
): Promise<InstallmentQuoteResult> {
  const [inst] = await db
    .select()
    .from(installments)
    .where(and(eq(installments.id, installmentId), eq(installments.tenantId, tenantId)))
    .limit(1)

  if (!inst) {
    throw new BusinessError(
      'INSTALLMENT_NOT_FOUND',
      'Parcela não encontrada ou não pertence a esta clínica',
    )
  }

  if (inst.status === 'paid') {
    throw new BusinessError('INSTALLMENT_ALREADY_PAID', 'Parcela já está totalmente paga')
  }
  if (inst.status === 'cancelled') {
    throw new BusinessError('INSTALLMENT_CANCELLED', 'Parcela cancelada não pode receber pagamento')
  }

  const livePayments = await loadLivePayments(db, installmentId)
  const pricedAt = await paymentDateAfterLivePayments(db, tenantId, inst, livePayments.rows, asOf)

  return {
    ...quoteInstallment(toInstallmentBase(inst), livePayments.inputs, pricedAt),
    asOf: asOf.toISOString(),
  }
}
