import * as Sentry from '@sentry/nextjs'
import { db } from '@/db/client'
import { tenants } from '@/db/schema'
import { listAutomations, upsertConversation, createMessage, pushSseEvent } from '@/db/queries/whatsapp'
import { sendTemplateMessage, resolveTemplateBody, getTemplateForTenant } from '@/lib/whatsapp'
import { CreditExhaustedError } from '@/lib/whatsapp-credits'
import { InvalidWhatsAppPhoneError, normalizeBrPhoneForWhatsApp } from '@/lib/phone'
import { isSubscriptionActive } from '@/lib/plans'

export type TemplateAutomationTrigger = 'follow_up' | 'payment_reminder'

export interface DueMessage {
  /** Identifies the message in logs and Sentry; never shown to anyone. */
  ref: string
  patientId: string
  patientName: string
  phone: string
  params: Record<string, string>
  markSent: () => Promise<void>
}

export interface LoadDueArgs {
  tenantId: string
  tenantName: string
  config: Record<string, unknown>
}

type OutcomeReason =
  | 'wa_disabled'
  | 'subscription_inactive'
  | 'no_automation'
  | 'template_missing'
  | 'template_not_approved'
  | 'no_messages_due'
  | 'sent'
  | 'send_failed'
  | 'credit_exhausted'
  | 'tenant_error'

export interface TemplateAutomationOutcome {
  tenantId: string
  tenantName: string
  reason: OutcomeReason
  sent: number
  failed: number
}

/**
 * Runs one template automation across every tenant: the same gates as the
 * confirmation cron (WhatsApp on, subscription active, automation enabled,
 * template approved), then sends each due message and marks it sent. Vercel
 * discards the response, so outcomes are logged per tenant and real failures
 * go to Sentry.
 */
export async function runTemplateAutomation(
  trigger: TemplateAutomationTrigger,
  loadDue: (args: LoadDueArgs) => Promise<DueMessage[]>,
) {
  const allTenants = await db
    .select({ id: tenants.id, name: tenants.name, settings: tenants.settings })
    .from(tenants)

  const outcomes: TemplateAutomationOutcome[] = []
  for (const tenant of allTenants) {
    outcomes.push(await runForTenant(trigger, tenant, loadDue))
  }

  const summary = outcomes.reduce<Partial<Record<OutcomeReason, number>>>((acc, o) => {
    acc[o.reason] = (acc[o.reason] ?? 0) + 1
    return acc
  }, {})
  const sent = outcomes.reduce((total, o) => total + o.sent, 0)

  for (const outcome of outcomes) {
    console.log(`[cron] whatsapp ${trigger} outcome`, JSON.stringify(outcome))
  }
  console.log(`[cron] whatsapp ${trigger} run summary`, JSON.stringify({
    tenantsProcessed: allTenants.length,
    sent,
    summary,
  }))

  return { ok: true, sent, outcomes, summary }
}

async function runForTenant(
  trigger: TemplateAutomationTrigger,
  tenant: { id: string; name: string; settings: unknown },
  loadDue: (args: LoadDueArgs) => Promise<DueMessage[]>,
): Promise<TemplateAutomationOutcome> {
  const outcome = (reason: OutcomeReason, sent = 0, failed = 0): TemplateAutomationOutcome => ({
    tenantId: tenant.id,
    tenantName: tenant.name,
    reason,
    sent,
    failed,
  })

  const settings = tenant.settings as Record<string, unknown> | null
  const mode = (settings?.whatsapp_mode as string) ?? 'floraclin'
  if (mode !== 'floraclin' && !settings?.whatsapp_enabled) return outcome('wa_disabled')

  try {
    if (!(await isSubscriptionActive(tenant.id))) return outcome('subscription_inactive')

    const automation = (await listAutomations(tenant.id)).find(
      (a) => a.trigger === trigger && a.enabled,
    )
    if (!automation) return outcome('no_automation')

    const template = await getTemplateForTenant(tenant.id, trigger)
    if (!template) return outcome('template_missing')
    if (template.status !== 'APPROVED') return outcome('template_not_approved')

    const due = await loadDue({
      tenantId: tenant.id,
      tenantName: tenant.name,
      config: (automation.config as Record<string, unknown> | null) ?? {},
    })
    if (due.length === 0) return outcome('no_messages_due')

    let sent = 0
    let failed = 0
    for (const message of due) {
      try {
        const phone = normalizeBrPhoneForWhatsApp(message.phone)
        const result = await sendTemplateMessage(
          tenant.id,
          {
            actor: { type: 'system' },
            recipient: { patientId: message.patientId, name: message.patientName },
          },
          phone,
          template.name,
          template.language,
          message.params,
        )
        // Marked before the inbox bookkeeping: a failure there must not make
        // the next run send the same message again.
        await message.markSent()

        const conversation = await upsertConversation(
          tenant.id,
          phone,
          message.patientName,
          undefined,
          message.patientId,
        )
        const created = await createMessage(tenant.id, conversation.id, {
          direction: 'outbound',
          metaMessageId: result.metaMessageId,
          body: resolveTemplateBody(template.components, message.params),
          templateName: template.name,
          deliveryStatus: 'sent',
        })
        await pushSseEvent(tenant.id, 'new_message', {
          conversationId: conversation.id,
          message: created,
        })
        sent++
      } catch (err) {
        if (err instanceof CreditExhaustedError) {
          Sentry.captureMessage(`WhatsApp credits exhausted during ${trigger} cron`, {
            level: 'warning',
            extra: {
              tenantId: tenant.id,
              tenantName: tenant.name,
              creditsUsed: err.creditsUsed,
              creditsTotal: err.creditsTotal,
              sentBeforeExhaustion: sent,
            },
          })
          return outcome('credit_exhausted', sent, failed)
        }
        if (err instanceof InvalidWhatsAppPhoneError) {
          console.warn(`[cron] Skipping ${trigger} ${message.ref}: ${err.message}`)
          continue
        }
        console.error(`[cron] Failed to send ${trigger} ${message.ref}:`, err)
        Sentry.captureException(err, {
          extra: { tenantId: tenant.id, tenantName: tenant.name, trigger, ref: message.ref },
        })
        failed++
      }
    }

    if (sent > 0) return outcome('sent', sent, failed)
    return outcome(failed > 0 ? 'send_failed' : 'no_messages_due', sent, failed)
  } catch (err) {
    console.error(`[cron] ${trigger} failed for tenant ${tenant.name}:`, err)
    Sentry.captureException(err, {
      extra: { tenantId: tenant.id, tenantName: tenant.name, trigger },
    })
    return outcome('tenant_error')
  }
}
