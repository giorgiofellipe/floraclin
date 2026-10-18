import { NextResponse } from 'next/server'
import { getInstallmentsDueReminder, markPaymentReminderSent } from '@/db/queries/financial'
import { withCronMonitor } from '@/lib/cron-monitor'
import { brToday, shiftBrYmd } from '@/lib/dates'
import { runTemplateAutomation, type DueMessage, type LoadDueArgs } from '@/lib/whatsapp-automation-cron'

// Schedule mirrors `vercel.json`: 12:00 UTC is 09:00 BRT.
const MONITOR_SLUG = 'whatsapp-payment-reminder'
const MONITOR_SCHEDULE = '0 12 * * *'

const DEFAULT_DAYS_BEFORE_DUE = 3

const amountFormat = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret || request.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const result = await withCronMonitor(MONITOR_SLUG, MONITOR_SCHEDULE, () =>
    runTemplateAutomation('payment_reminder', loadDueReminders),
  )
  return NextResponse.json(result)
}

async function loadDueReminders({ tenantId, tenantName, config }: LoadDueArgs): Promise<DueMessage[]> {
  const days = Number(config.daysBeforeDue) || DEFAULT_DAYS_BEFORE_DUE
  const today = brToday()
  // The whole window, not only today + N: an installment created inside it,
  // or a missed run, still gets its one reminder before the due date.
  const installments = await getInstallmentsDueReminder(tenantId, today, shiftBrYmd(today, days))

  return installments.flatMap((installment) => {
    const remaining = Number(installment.amount) - Number(installment.amountPaid)
    if (remaining <= 0) return []
    const [y, m, d] = installment.dueDate.split('-')
    return [{
      ref: `installment ${installment.id}`,
      patientId: installment.patientId,
      patientName: installment.patientName,
      phone: installment.patientPhone,
      params: {
        '1': installment.patientName.split(' ')[0] || installment.patientName,
        '2': amountFormat.format(remaining),
        '3': tenantName,
        '4': `${d}/${m}/${y}`,
      },
      markSent: () => markPaymentReminderSent(tenantId, installment.id),
    }]
  })
}
