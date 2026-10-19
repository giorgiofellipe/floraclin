import * as Sentry from '@sentry/nextjs'
import { getTenant } from '@/db/queries/tenants'
import { listAutomations } from '@/db/queries/whatsapp'
import { getTemplateForTenant } from '@/lib/whatsapp'
import { sendAndRecordTemplate } from '@/lib/whatsapp-automated-send'
import { buildTemplateParams, missingTemplateKeys } from '@/lib/whatsapp-blueprints'
import { CreditExhaustedError } from '@/lib/whatsapp-credits'
import { InvalidWhatsAppPhoneError, normalizeBrPhoneForWhatsApp } from '@/lib/phone'
import { isSubscriptionActive } from '@/lib/plans'
import { isWhatsAppEnabled } from '@/lib/whatsapp-mode'
import { reportSideEffectFailure } from '@/lib/observability'
import type { EventAutomationTrigger } from '@/lib/whatsapp-automation-config'

export interface EventMessage {
  ref: string
  patientId: string
  patientName: string
  phone: string
  /** Template values keyed by variable key, e.g. `patient_name`. */
  values: Record<string, string>
}

/**
 * Sends an event automation when the clinic turned it on. Runs after the
 * event is saved, so it never throws: a failed message must not fail the
 * action that caused it.
 */
export async function runEventAutomation(
  trigger: EventAutomationTrigger,
  tenantId: string,
  loadMessages: (args: { tenantName: string }) => Promise<EventMessage[]>,
) {
  const report = (err: unknown, extra: Record<string, unknown> = {}) =>
    reportSideEffectFailure(err, { area: 'whatsapp', step: trigger, extra: { tenantId, ...extra } })

  try {
    const tenant = await getTenant(tenantId)
    if (!tenant || !isWhatsAppEnabled(tenant.settings as Record<string, unknown> | null)) return
    if (!(await isSubscriptionActive(tenantId))) return

    const automations = await listAutomations(tenantId)
    if (!automations.some((a) => a.trigger === trigger && a.enabled)) return

    const template = await getTemplateForTenant(tenantId, trigger)
    if (template?.status !== 'APPROVED') return

    const messages = await loadMessages({ tenantName: tenant.name })
    if (messages.length === 0) return

    const missingKeys = missingTemplateKeys(template, Object.keys(messages[0].values))
    if (missingKeys.length > 0) {
      Sentry.captureMessage(`WhatsApp ${trigger} template needs values the automation does not supply`, {
        level: 'warning',
        extra: { tenantId, template: template.name, missingKeys },
      })
      return
    }

    for (const message of messages) {
      try {
        await sendAndRecordTemplate({
          tenantId,
          phone: normalizeBrPhoneForWhatsApp(message.phone),
          recipient: { patientId: message.patientId, name: message.patientName },
          template,
          params: buildTemplateParams(template, message.values),
        })
      } catch (err) {
        if (err instanceof InvalidWhatsAppPhoneError) continue
        if (err instanceof CreditExhaustedError) {
          Sentry.captureMessage(`WhatsApp credits exhausted during ${trigger}`, {
            level: 'warning',
            extra: { tenantId, creditsUsed: err.creditsUsed, creditsTotal: err.creditsTotal },
          })
          return
        }
        report(err, { ref: message.ref })
      }
    }
  } catch (err) {
    report(err)
  }
}
