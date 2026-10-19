import * as Sentry from '@sentry/nextjs'
import { db } from '@/db/client'
import { tenants } from '@/db/schema'
import { listAutomations } from '@/db/queries/whatsapp'
import { getTemplateForTenant } from '@/lib/whatsapp'
import { sendAndRecordTemplate } from '@/lib/whatsapp-automated-send'
import { buildTemplateParams, missingTemplateKeys } from '@/lib/whatsapp-blueprints'
import { CreditExhaustedError } from '@/lib/whatsapp-credits'
import { InvalidWhatsAppPhoneError, normalizeBrPhoneForWhatsApp } from '@/lib/phone'
import { isSubscriptionActive } from '@/lib/plans'
import { isWhatsAppEnabled } from '@/lib/whatsapp-mode'
import { reportSideEffectFailure } from '@/lib/observability'
import { parseAutomationConfig, type AutomationConfig, type AutomationTrigger } from '@/lib/whatsapp-automation-config'

type TemplateAutomationTrigger = Exclude<AutomationTrigger, 'appointment_confirmation'>

export interface DueMessage {
  ref: string
  patientId: string
  patientName: string
  phone: string
  values: Record<string, string>
  /**
   * Sets the sent marker before the send, so an overlapping run (a Vercel
   * retry, a manual run) skips the message. False means it is already taken.
   */
  claim: () => Promise<boolean>
  release: () => Promise<void>
}

export interface LoadDueArgs<T extends TemplateAutomationTrigger> {
  tenantId: string
  tenantName: string
  config: AutomationConfig<T>
}

type OutcomeReason =
  | 'wa_disabled'
  | 'subscription_inactive'
  | 'no_automation'
  | 'template_missing'
  | 'template_not_approved'
  | 'template_incompatible'
  | 'no_messages_due'
  | 'sent'
  | 'send_failed'
  | 'credit_exhausted'
  | 'tenant_error'

interface TemplateAutomationOutcome {
  tenantId: string
  tenantName: string
  reason: OutcomeReason
  sent: number
  failed: number
}

/**
 * Runs one template automation across every tenant. Vercel discards the
 * response, so outcomes are logged per tenant and real failures go to Sentry.
 */
export async function runTemplateAutomation<T extends TemplateAutomationTrigger>(
  trigger: T,
  loadDue: (args: LoadDueArgs<T>) => Promise<DueMessage[]>,
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

async function runForTenant<T extends TemplateAutomationTrigger>(
  trigger: T,
  tenant: { id: string; name: string; settings: unknown },
  loadDue: (args: LoadDueArgs<T>) => Promise<DueMessage[]>,
): Promise<TemplateAutomationOutcome> {
  const outcome = (reason: OutcomeReason, sent = 0, failed = 0): TemplateAutomationOutcome => ({
    tenantId: tenant.id,
    tenantName: tenant.name,
    reason,
    sent,
    failed,
  })

  if (!isWhatsAppEnabled(tenant.settings as Record<string, unknown> | null)) return outcome('wa_disabled')

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
      config: parseAutomationConfig(trigger, automation.config),
    })
    if (due.length === 0) return outcome('no_messages_due')

    const missingKeys = missingTemplateKeys(template, Object.keys(due[0].values))
    if (missingKeys.length > 0) {
      Sentry.captureMessage(`WhatsApp ${trigger} template needs values the automation does not supply`, {
        level: 'warning',
        extra: { tenantId: tenant.id, tenantName: tenant.name, template: template.name, missingKeys },
      })
      return outcome('template_incompatible')
    }

    let sent = 0
    let failed = 0
    for (const message of due) {
      let phone: string
      try {
        phone = normalizeBrPhoneForWhatsApp(message.phone)
      } catch (err) {
        if (!(err instanceof InvalidWhatsAppPhoneError)) throw err
        console.warn(`[cron] Skipping ${trigger} ${message.ref}: ${err.message}`)
        continue
      }
      if (!(await message.claim())) continue
      try {
        await sendAndRecordTemplate({
          tenantId: tenant.id,
          phone,
          recipient: { patientId: message.patientId, name: message.patientName },
          template,
          params: buildTemplateParams(template, message.values),
        })
        sent++
      } catch (err) {
        await releaseClaim(trigger, message)
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

async function releaseClaim(trigger: TemplateAutomationTrigger, message: DueMessage) {
  try {
    await message.release()
  } catch (err) {
    reportSideEffectFailure(err, { area: 'whatsapp', step: `${trigger}_release_claim`, extra: { ref: message.ref } })
  }
}
