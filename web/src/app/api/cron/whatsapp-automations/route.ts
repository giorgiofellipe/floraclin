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
import { withCronMonitor } from '@/lib/observability'

// Schedule mirrors `vercel.json`; see withCronMonitor for the rest. This is
// the cron a clinic notices first when it stops running, so it gets the same
// dead-man's switch as the other two.
const MONITOR_SLUG = 'whatsapp-automations'
const MONITOR_SCHEDULE = '0 11 * * *'

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
// to pick which tenants it lists by name. Typed from the Discord union (not
// TenantOutcomeReason) so adding a reason here without teaching discord.ts
// about it fails typecheck instead of silently printing "undefined".
const FAILING_REASONS: ReadonlySet<WhatsappDigestFailingTenant['reason']> =
  new Set<WhatsappDigestFailingTenant['reason']>(['send_failed', 'tenant_error', 'credit_exhausted'])

const isFailingReason = (
  reason: TenantOutcomeReason,
): reason is WhatsappDigestFailingTenant['reason'] =>
  FAILING_REASONS.has(reason as WhatsappDigestFailingTenant['reason'])

// Builds a zero-appointments outcome for a gate that skipped the tenant
// before it ever got to sending anything. Keeps the gate sequence below
// readable as a list of gates rather than seven near-identical object
// literals.
function skipOutcome(
  tenantId: string,
  tenantName: string,
  reason: TenantOutcomeReason,
): TenantOutcome {
  return {
    tenantId,
    tenantName,
    reason,
    appointmentsSent: 0,
    appointmentsFailed: 0,
  }
}

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const result = await withCronMonitor(MONITOR_SLUG, MONITOR_SCHEDULE, runAutomations)

  return NextResponse.json(result)
}

/**
 * The job itself, lifted out of the handler so it can be handed to
 * `withCronMonitor` whole. Nothing in here touches the request.
 */
async function runAutomations() {
  const allTenants = await db
    .select({ id: tenants.id, name: tenants.name, settings: tenants.settings })
    .from(tenants)

  const outcomes: TenantOutcome[] = []

  const waEnabled = allTenants.filter((t) => {
    const s = t.settings as Record<string, unknown> | null
    const mode = (s?.whatsapp_mode as string) ?? 'floraclin'
    if (mode === 'floraclin') return true
    if (s?.whatsapp_enabled) return true
    outcomes.push(skipOutcome(t.id, t.name, 'wa_disabled'))
    return false
  })

  let sent = 0

  for (const tenant of waEnabled) {
    try {
      if (!(await isSubscriptionActive(tenant.id))) {
        outcomes.push(skipOutcome(tenant.id, tenant.name, 'subscription_inactive'))
        continue
      }

      const automations = await listAutomations(tenant.id)
      const confirmationAuto = automations.find(
        (a) => a.trigger === 'appointment_confirmation' && a.enabled
      )
      if (!confirmationAuto) {
        outcomes.push(skipOutcome(tenant.id, tenant.name, 'no_automation'))
        continue
      }

      const template = await getTemplateForTenant(tenant.id, 'appointment_confirmation')
      if (!template) {
        outcomes.push(skipOutcome(tenant.id, tenant.name, 'template_missing'))
        continue
      }
      if (template.status !== 'APPROVED') {
        outcomes.push(skipOutcome(tenant.id, tenant.name, 'template_not_approved'))
        continue
      }

      const pendingAppointments = await getAppointmentsPendingConfirmationUntil(
        tenant.id,
      )

      if (pendingAppointments.length === 0) {
        outcomes.push(skipOutcome(tenant.id, tenant.name, 'no_pending_appointments'))
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

      // Every pending appointment with a phone either sends, fails, or
      // trips creditExhausted (which breaks the loop), so if none of the
      // first three branches match, no appointment had a usable phone.
      let reason: TenantOutcomeReason
      if (creditExhausted) {
        reason = 'credit_exhausted'
      } else if (tenantSent > 0) {
        reason = 'sent'
      } else if (tenantFailed > 0) {
        reason = 'send_failed'
      } else {
        reason = 'no_valid_phone'
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
      outcomes.push(skipOutcome(tenant.id, tenant.name, 'tenant_error'))
    }
  }

  const summary = outcomes.reduce<Partial<Record<TenantOutcomeReason, number>>>((acc, o) => {
    acc[o.reason] = (acc[o.reason] ?? 0) + 1
    return acc
  }, {})

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
    .filter(
      (o): o is TenantOutcome & { reason: WhatsappDigestFailingTenant['reason'] } =>
        isFailingReason(o.reason),
    )
    .map((o) => ({
      tenantName: o.tenantName,
      reason: o.reason,
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

  return { ok: true, sent, outcomes, summary }
}

function formatDateBr(dateStr: string): string {
  const [y, m, d] = dateStr.split('-')
  return `${d}/${m}/${y}`
}
