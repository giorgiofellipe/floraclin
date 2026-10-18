import { claimPaymentReminder, getInstallmentsDueReminder, releasePaymentReminder } from '@/db/queries/financial'
import { brToday, shiftBrYmd } from '@/lib/dates'
import { formatDate } from '@/lib/utils'
import { firstName } from '@/lib/whatsapp-blueprints'
import type { DueMessage, LoadDueArgs } from '@/lib/whatsapp-automation-cron'

const amountFormat = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export async function loadDueReminders({
  tenantId,
  tenantName,
  config,
}: LoadDueArgs<'payment_reminder'>): Promise<DueMessage[]> {
  const today = brToday()
  // The whole window, not only today + N: an installment created inside it,
  // or a missed run, still gets its one reminder before the due date.
  const installments = await getInstallmentsDueReminder(tenantId, today, shiftBrYmd(today, config.daysBeforeDue))

  return installments.map((installment) => ({
    ref: `installment ${installment.id}`,
    patientId: installment.patientId,
    patientName: installment.patientName,
    phone: installment.patientPhone,
    values: {
      patient_name: firstName(installment.patientName),
      amount: amountFormat.format(Number(installment.amount) - Number(installment.amountPaid)),
      clinic_name: tenantName,
      due_date: formatDate(installment.dueDate),
    },
    claim: () => claimPaymentReminder(tenantId, installment.id),
    release: () => releasePaymentReminder(tenantId, installment.id),
  }))
}
