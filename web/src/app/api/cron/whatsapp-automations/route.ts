import { NextResponse } from 'next/server'
import { db } from '@/db/client'
import { tenants } from '@/db/schema'
import { getAppointmentsPendingConfirmationUntil, markConfirmationSent } from '@/db/queries/appointments'
import { listAutomations, getTemplateByPurpose, upsertConversation, createMessage, pushSseEvent } from '@/db/queries/whatsapp'
import { sendTemplateMessage, resolveTemplateBody } from '@/lib/whatsapp'
import { normalizeBrPhone } from '@/lib/phone'

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const allTenants = await db
    .select({ id: tenants.id, name: tenants.name, settings: tenants.settings })
    .from(tenants)

  const waEnabled = allTenants.filter((t) => {
    const s = t.settings as Record<string, unknown> | null
    return s?.whatsapp_enabled
  })

  let sent = 0
  let skipped = 0
  const errors: Array<{ tenant: string; error: string }> = []

  for (const tenant of waEnabled) {
    try {
      const automations = await listAutomations(tenant.id)
      const confirmationAuto = automations.find(
        (a) => a.trigger === 'appointment_confirmation' && a.enabled
      )
      if (!confirmationAuto) {
        skipped++
        continue
      }

      const template = await getTemplateByPurpose(tenant.id, 'appointment_confirmation')
      if (!template || template.status !== 'APPROVED') {
        skipped++
        continue
      }

      const pendingAppointments = await getAppointmentsPendingConfirmationUntil(
        tenant.id,
      )

      for (const appt of pendingAppointments) {
        try {
          const phone = appt.patientPhone ?? appt.bookingPhone
          if (!phone) continue

          const normalizedPhone = normalizeBrPhone(phone)
          const name = appt.patientName ?? appt.bookingName ?? ''

          const params: Record<string, string> = {
            '1': name.split(' ')[0] || name,
            '2': tenant.name,
            '3': formatDateBr(appt.date),
            '4': appt.startTime.slice(0, 5),
          }

          const result = await sendTemplateMessage(
            tenant.id,
            normalizedPhone,
            template.name,
            template.language,
            params,
          )

          await markConfirmationSent(tenant.id, appt.id, result.metaMessageId)

          const conversation = await upsertConversation(
            tenant.id,
            normalizedPhone,
            name,
            undefined,
            appt.patientId ?? undefined,
          )

          const resolvedBody = resolveTemplateBody(template.components, params)

          const message = await createMessage(tenant.id, conversation.id, {
            direction: 'outbound',
            metaMessageId: result.metaMessageId,
            body: resolvedBody,
            templateName: template.name,
            deliveryStatus: 'sent',
          })

          await pushSseEvent(tenant.id, 'new_message', {
            conversationId: conversation.id,
            message,
          })

          sent++
        } catch (err) {
          console.error(`[cron] Failed to send confirmation for appointment ${appt.id}:`, err)
          errors.push({
            tenant: tenant.name,
            error: `appointment ${appt.id}: ${err instanceof Error ? err.message : String(err)}`,
          })
        }
      }
    } catch (err) {
      console.error(`[cron] Failed for tenant ${tenant.name}:`, err)
      errors.push({
        tenant: tenant.name,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return NextResponse.json({ ok: true, sent, skipped, errors })
}

function formatDateBr(dateStr: string): string {
  const [y, m, d] = dateStr.split('-')
  return `${d}/${m}/${y}`
}
