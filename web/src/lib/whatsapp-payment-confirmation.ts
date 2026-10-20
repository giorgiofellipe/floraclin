import { getPaymentRecipients } from '@/db/queries/financial'
import { brCalendarDaysBetween } from '@/lib/dates'
import { firstName } from '@/lib/utils'
import { MAX_EVENT_AGE_DAYS } from '@/lib/whatsapp-automation-config'
import { runEventAutomation } from '@/lib/whatsapp-automation-event'

const amountFormat = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

interface RecordedPayment {
  installmentId: string
  amount: string
  paidAt: Date
}

/** One message per patient, with the sum of what they paid in this action. */
export function sendPaymentConfirmations(tenantId: string, payments: RecordedPayment[]) {
  const now = new Date()
  const recent = payments.filter((p) => brCalendarDaysBetween(p.paidAt, now) <= MAX_EVENT_AGE_DAYS)
  if (recent.length === 0) return Promise.resolve()

  return runEventAutomation('payment_confirmation', tenantId, async () => {
    const recipients = await getPaymentRecipients(tenantId, recent.map((p) => p.installmentId))
    const recipientByInstallment = new Map(recipients.map((r) => [r.installmentId, r]))

    const byPatient = new Map<string, { recipient: (typeof recipients)[number]; total: number }>()
    for (const payment of recent) {
      const recipient = recipientByInstallment.get(payment.installmentId)
      if (!recipient) continue
      const entry = byPatient.get(recipient.patientId) ?? { recipient, total: 0 }
      entry.total += Number(payment.amount)
      byPatient.set(recipient.patientId, entry)
    }

    return [...byPatient.values()].map(({ recipient, total }) => ({
      ref: `patient ${recipient.patientId}`,
      patientId: recipient.patientId,
      patientName: recipient.patientName,
      phone: recipient.patientPhone,
      values: { patient_name: firstName(recipient.patientName), amount: amountFormat.format(total) },
    }))
  })
}
