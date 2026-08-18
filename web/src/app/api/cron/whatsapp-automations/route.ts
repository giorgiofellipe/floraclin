import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { db } from '@/db/client'
import { tenants } from '@/db/schema'
import { getAppointmentsPendingConfirmationUntil, markConfirmationSent } from '@/db/queries/appointments'
import { listAutomations, upsertConversation, createMessage, pushSseEvent } from '@/db/queries/whatsapp'
import { sendTemplateMessage, resolveTemplateBody, CreditExhaustedError, getTemplateForTenant } from '@/lib/whatsapp'
import { normalizeBrPhone } from '@/lib/phone'
import { isSubscriptionActive } from '@/lib/plans'
import { notifyDiscord, type WhatsappDigestFailingTenant } from '@/lib/discord'

// Vercel invokes this route and discards the response body, so nothing in
// here can rely on a human reading `NextResponse.json(...)`. Every tenant
// gets exactly one outcome reason recorded below, and every reason that
// represents a real problem (as opposed to an expected skip) is also
// reported to Sentry so it surfaces through the existing Discord alert rule
// (see docs/runbooks/observability.md).
type TenantOutcomeReason =
  | 'wa_disabled'
  | 'subscription_inactive'
  | 'no_automation'
  | 'template_missing'
  | 'template_not_approved'
  | 'no_pending_appointments'
  | 'no_valid_phone'
  | 'sent'
  | 'send_failed'
  | 'credit_exhausted'
  | 'tenant_error'

interface TenantOutcome {
  tenantId: string
  tenantName: string
  reason: TenantOutcomeReason
  appointmentsSent: number
  appointmentsFailed: number
}

// Reasons that represent a real problem rather than an expected skip. Used
// both to decide whether the Discord digest is "routine" or "abnormal" and
// to pick which tenants it lists by name.
const FAILING_REASONS: ReadonlySet<TenantOutcomeReason> = new Set([
  'send_failed',
  'tenant_error',
  'credit_exhausted',
])

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const allTenants = await db
    .select({ id: tenants.id, name: tenants.name, settings: tenants.settings })
    .from(tenants)

  const outcomes: TenantOutcome[] = []

  const waEnabled = allTenants.filter((t) => {
    const s = t.settings as Record<string, unknown> | null
    const mode = (s?.whatsapp_mode as string) ?? 'floraclin'
    if (mode === 'floraclin') return true
    if (s?.whatsapp_enabled) return true
    outcomes.push({
      tenantId: t.id,
      tenantName: t.name,
      reason: 'wa_disabled',
      appointmentsSent: 0,
      appointmentsFailed: 0,
    })
    return false
  })

  let sent = 0

  for (const tenant of waEnabled) {
    try {
      if (!(await isSubscriptionActive(tenant.id))) {
        outcomes.push({
          tenantId: tenant.id,
          tenantName: tenant.name,
          reason: 'subscription_inactive',
          appointmentsSent: 0,
          appointmentsFailed: 0,
        })
        continue
      }

      const automations = await listAutomations(tenant.id)
      const confirmationAuto = automations.find(
        (a) => a.trigger === 'appointment_confirmation' && a.enabled
      )
      if (!confirmationAuto) {
        outcomes.push({
          tenantId: tenant.id,
          tenantName: tenant.name,
          reason: 'no_automation',
          appointmentsSent: 0,
          appointmentsFailed: 0,
        })
        continue
      }

      const template = await getTemplateForTenant(tenant.id, 'appointment_confirmation')
      if (!template) {
        outcomes.push({
          tenantId: tenant.id,
          tenantName: tenant.name,
          reason: 'template_missing',
          appointmentsSent: 0,
          appointmentsFailed: 0,
        })
        continue
      }
      if (template.status !== 'APPROVED') {
        outcomes.push({
          tenantId: tenant.id,
          tenantName: tenant.name,
          reason: 'template_not_approved',
          appointmentsSent: 0,
          appointmentsFailed: 0,
        })
        continue
      }

      const pendingAppointments = await getAppointmentsPendingConfirmationUntil(
        tenant.id,
      )

      if (pendingAppointments.length === 0) {
        outcomes.push({
          tenantId: tenant.id,
          tenantName: tenant.name,
          reason: 'no_pending_appointments',
          appointmentsSent: 0,
          appointmentsFailed: 0,
        })
        continue
      }

      let tenantSent = 0
      let tenantFailed = 0
      let tenantHadPhone = false
      let creditExhausted = false

      for (const appt of pendingAppointments) {
        try {
          const phone = appt.patientPhone ?? appt.bookingPhone
          if (!phone) continue
          tenantHadPhone = true

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
          tenantSent++
        } catch (err) {
          if (err instanceof CreditExhaustedError) {
            // Not a bug: the clinic ran out of WhatsApp credits. Reported as
            // a warning message (not captureException) so it doesn't read as
            // a code defect, but it still creates a Sentry issue and reaches
            // the floraclin-logs Discord alert so a human buys more credits.
            console.warn(`[cron] Credits exhausted for tenant ${tenant.name}, skipping remaining appointments`)
            Sentry.captureMessage('WhatsApp credits exhausted during appointment-confirmation cron', {
              level: 'warning',
              extra: {
                tenantId: tenant.id,
                tenantName: tenant.name,
                creditsUsed: err.creditsUsed,
                creditsTotal: err.creditsTotal,
                appointmentsSentBeforeExhaustion: tenantSent,
              },
            })
            creditExhausted = true
            break
          }
          console.error(`[cron] Failed to send confirmation for appointment ${appt.id}:`, err)
          Sentry.captureException(err, {
            extra: {
              tenantId: tenant.id,
              tenantName: tenant.name,
              appointmentId: appt.id,
            },
          })
          tenantFailed++
        }
      }

      let reason: TenantOutcomeReason
      if (creditExhausted) {
        reason = 'credit_exhausted'
      } else if (tenantSent > 0) {
        reason = 'sent'
      } else if (tenantFailed > 0) {
        reason = 'send_failed'
      } else if (!tenantHadPhone) {
        reason = 'no_valid_phone'
      } else {
        reason = 'no_pending_appointments'
      }

      outcomes.push({
        tenantId: tenant.id,
        tenantName: tenant.name,
        reason,
        appointmentsSent: tenantSent,
        appointmentsFailed: tenantFailed,
      })
    } catch (err) {
      // A gate itself blew up (DB error, etc). This is a bug, not an
      // expected skip, so it goes to Sentry as an exception.
      console.error(`[cron] Failed for tenant ${tenant.name}:`, err)
      Sentry.captureException(err, {
        extra: { tenantId: tenant.id, tenantName: tenant.name },
      })
      outcomes.push({
        tenantId: tenant.id,
        tenantName: tenant.name,
        reason: 'tenant_error',
        appointmentsSent: 0,
        appointmentsFailed: 0,
      })
    }
  }

  const summary = outcomes.reduce<Record<TenantOutcomeReason, number>>((acc, o) => {
    acc[o.reason] = (acc[o.reason] ?? 0) + 1
    return acc
  }, {} as Record<TenantOutcomeReason, number>)

  // One line per tenant, not one line for the whole array. At today's scale
  // (~10 tenants) this stays well within a page of Vercel's log viewer, and
  // unlike a single JSON-array line it lets you scan or grep a specific
  // tenant's outcome directly, which is the exact question this branch
  // exists to answer ("why did this clinic get nothing").  The `outcomes`
  // array in the JSON response below is discarded by Vercel, so this is the
  // only place any of this detail survives the run.
  for (const outcome of outcomes) {
    console.log('[cron] whatsapp-automations outcome', JSON.stringify(outcome))
  }

  // One structured, greppable line with the whole run's shape. Deliberately
  // NOT also sent to Sentry as a rollup message: every send_failed and
  // tenant_error outcome above already reached Sentry individually with the
  // tenant/appointment/error detail needed to act on it. A duplicate
  // aggregate message would only add noise to floraclin-logs without adding
  // information -- the per-failure captures are strictly more actionable.
  console.log('[cron] whatsapp-automations run summary', JSON.stringify({
    tenantsProcessed: allTenants.length,
    sent,
    summary,
  }))

  // Daily heartbeat to floraclin-logs, every run, success or not. Silence
  // today is ambiguous between "nothing to send" and "the cron never ran";
  // posting on every run turns a quiet channel into a real signal. This is
  // reporting, not part of the job: notifyDiscord never throws, so a down
  // or unconfigured Discord can never fail the cron.
  const failingTenants: WhatsappDigestFailingTenant[] = outcomes
    .filter((o) => FAILING_REASONS.has(o.reason))
    .map((o) => ({
      tenantName: o.tenantName,
      reason: o.reason as WhatsappDigestFailingTenant['reason'],
      appointmentsFailed: o.appointmentsFailed,
    }))

  // notifyDiscord already never throws by contract (see web/src/lib/discord.ts),
  // but the digest is reporting, not part of the job -- this catch is belt
  // and suspenders so a future change to that contract can never take the
  // cron down with it.
  try {
    await notifyDiscord({
      kind: 'whatsapp_automations.digest',
      tenantsProcessed: allTenants.length,
      sent,
      summary,
      failingTenants,
    })
  } catch (err) {
    console.error('[cron] Failed to post whatsapp-automations digest to Discord:', err)
  }

  return NextResponse.json({ ok: true, sent, outcomes, summary })
}

function formatDateBr(dateStr: string): string {
  const [y, m, d] = dateStr.split('-')
  return `${d}/${m}/${y}`
}
