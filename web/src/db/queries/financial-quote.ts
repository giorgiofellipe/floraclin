import { and, eq, isNull } from 'drizzle-orm'
import { db } from '@/db/client'
import { installments, paymentRecords } from '@/db/schema'
import { loadFinancialSettings } from '@/db/queries/financial'
import { BusinessError } from '@/lib/errors'
import {
  quoteInstallment,
  type InstallmentBase,
  type InstallmentQuote,
  type PaymentInput,
} from '@/lib/financial/penalties'

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

  // The write path resolves settings through this same helper. Duplicating its
  // fallbacks here is how the quote and the charge drift apart: a tenant with
  // no settings row would be quoted at 0% and charged at 2%.
  const settings = await loadFinancialSettings(db, tenantId)

  const payments = await db
    .select()
    .from(paymentRecords)
    .where(
      and(eq(paymentRecords.installmentId, installmentId), isNull(paymentRecords.reversedAt)),
    )
    .orderBy(paymentRecords.paidAt)

  const base: InstallmentBase = {
    amount: Number(inst.amount),
    dueDate: inst.dueDate,
    appliedFineValue: Number(inst.appliedFineValue ?? settings.fineValue),
    appliedFineType: inst.appliedFineType ?? settings.fineType,
    appliedInterestRate: Number(inst.appliedInterestRate ?? settings.monthlyInterestPercent),
    gracePeriodDays: settings.gracePeriodDays,
  }

  const prior: PaymentInput[] = payments.map((p) => ({
    id: p.id,
    amount: Number(p.amount),
    paidAt: new Date(p.paidAt).toISOString(),
  }))

  return { ...quoteInstallment(base, prior, asOf), asOf: asOf.toISOString() }
}
