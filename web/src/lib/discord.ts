import { after } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { formatCurrency } from '@/lib/utils'

// Notifier for two Discord channels:
//
// - "floraclin" (DISCORD_WEBHOOK_EVENTS): business events -- the business
//   grew. clinic.created / clinic.approved / subscription.created.
// - "floraclin-logs" (DISCORD_WEBHOOK_LOGS): operational digests -- code
//   reporting on itself, e.g. the daily whatsapp-automations cron digest.
//   Distinct from Sentry, which also posts to "floraclin-logs" but via its
//   own Discord integration (configured in Sentry's UI, see
//   docs/runbooks/observability.md).
//
// Adding a new event kind means adding it to this union, which forces
// buildDiscordPayload's switch and webhookForEvent's mapping to be updated
// too.
export type WhatsappDigestFailingTenant = {
  tenantName: string
  reason: 'send_failed' | 'tenant_error' | 'credit_exhausted'
  appointmentsFailed: number
}

export type DiscordEvent =
  | { kind: 'clinic.created'; tenantName: string; city: string | null; state: string | null; tenantId: string }
  | { kind: 'clinic.approved'; tenantName: string; tenantId: string }
  | { kind: 'subscription.created'; tenantName: string; planName: string; priceCents: number; tenantId: string }
  | {
      kind: 'whatsapp_automations.digest'
      tenantsProcessed: number
      sent: number
      summary: Record<string, number>
      failingTenants: WhatsappDigestFailingTenant[]
    }

type DiscordEmbedField = { name: string; value: string; inline?: boolean }

type DiscordEmbed = {
  title: string
  color: number
  fields: DiscordEmbedField[]
  description?: string
  timestamp: string
}

export type DiscordPayload = {
  username: string
  embeds: DiscordEmbed[]
}

const COLOR_CREATED = 0x4a9d5f
const COLOR_APPROVED = 0x3b82f6
const COLOR_SUBSCRIPTION = 0xf59e0b
const COLOR_DIGEST_OK = 0x4a9d5f
const COLOR_DIGEST_ALERT = 0xef4444

function digestReasonLabel(reason: WhatsappDigestFailingTenant['reason']): string {
  switch (reason) {
    case 'send_failed':
      return 'falha ao enviar'
    case 'tenant_error':
      return 'erro ao processar'
    case 'credit_exhausted':
      return 'créditos esgotados'
  }
}

function adminTenantsUrl(): string {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
  return `${base}/admin/clinicas`
}

/**
 * Pure formatter: DiscordEvent -> Discord webhook payload. No I/O, so it can
 * be unit tested directly without touching fetch or env vars. Never include
 * anything beyond clinic name, city/state, plan, price and an admin link —
 * no owner name, email or phone. Patient data must never appear here because
 * none of the DiscordEvent variants carry it.
 */
export function buildDiscordPayload(event: DiscordEvent): DiscordPayload {
  const adminLink = adminTenantsUrl()

  switch (event.kind) {
    case 'clinic.created': {
      const location = [event.city, event.state].filter(Boolean).join('/')
      return {
        username: 'FloraClin',
        embeds: [
          {
            title: 'Nova clínica cadastrada',
            color: COLOR_CREATED,
            fields: [
              { name: 'Clínica', value: event.tenantName, inline: true },
              { name: 'Localização', value: location || 'Não informado', inline: true },
              { name: 'Admin', value: adminLink },
            ],
            timestamp: new Date().toISOString(),
          },
        ],
      }
    }
    case 'clinic.approved': {
      return {
        username: 'FloraClin',
        embeds: [
          {
            title: 'Clínica aprovada',
            color: COLOR_APPROVED,
            fields: [
              { name: 'Clínica', value: event.tenantName, inline: true },
              { name: 'Admin', value: adminLink },
            ],
            timestamp: new Date().toISOString(),
          },
        ],
      }
    }
    case 'subscription.created': {
      return {
        username: 'FloraClin',
        embeds: [
          {
            title: 'Nova assinatura',
            color: COLOR_SUBSCRIPTION,
            fields: [
              { name: 'Clínica', value: event.tenantName, inline: true },
              { name: 'Plano', value: event.planName, inline: true },
              { name: 'Valor', value: formatCurrency(event.priceCents / 100), inline: true },
              { name: 'Admin', value: adminLink },
            ],
            timestamp: new Date().toISOString(),
          },
        ],
      }
    }
    case 'whatsapp_automations.digest': {
      // Routine run: one compact line, totals only. Abnormal run (at least
      // one tenant with send_failed / tenant_error / credit_exhausted, the
      // reasons that represent a real problem rather than an expected skip):
      // same totals plus the failing clinics, so the digest itself answers
      // "which ones" without anyone needing to go dig through logs.
      const abnormal = event.failingTenants.length > 0
      const totals = `${event.tenantsProcessed} clínicas processadas, ${event.sent} confirmações enviadas.`

      if (!abnormal) {
        return {
          username: 'FloraClin',
          embeds: [
            {
              title: 'WhatsApp automations: execução diária',
              color: COLOR_DIGEST_OK,
              fields: [],
              description: totals,
              timestamp: new Date().toISOString(),
            },
          ],
        }
      }

      const failureLines = event.failingTenants.map((t) => {
        const detail = t.reason === 'send_failed' ? ` (${t.appointmentsFailed} confirmações)` : ''
        return `- ${t.tenantName}: ${digestReasonLabel(t.reason)}${detail}`
      })

      return {
        username: 'FloraClin',
        embeds: [
          {
            title: 'WhatsApp automations: falhas na execução',
            color: COLOR_DIGEST_ALERT,
            fields: [],
            description: `${totals}\n${event.failingTenants.length} clínica(s) com problema:\n${failureLines.join('\n')}`,
            timestamp: new Date().toISOString(),
          },
        ],
      }
    }
  }
}

function webhookForEvent(kind: DiscordEvent['kind']): string | undefined {
  if (kind === 'whatsapp_automations.digest') return process.env.DISCORD_WEBHOOK_LOGS
  return process.env.DISCORD_WEBHOOK_EVENTS
}

/**
 * Posts an event to its Discord channel -- "floraclin" for business events,
 * "floraclin-logs" for the whatsapp_automations digest (see webhookForEvent).
 * Three properties matter more than the formatting:
 *
 * 1. It can never break the caller. Every branch is wrapped so nothing
 *    throws out of this function, and the actual network call is deferred
 *    with after() so a slow or unreachable Discord never delays the
 *    response. Failures are reported to Sentry and otherwise swallowed.
 * 2. It is a no-op when unconfigured: no webhook URL for the event's
 *    destination means an immediate return, before building a payload or
 *    touching fetch. This is what keeps local dev and the test suite from
 *    posting to a real channel.
 * 3. It never posts personal data — enforced by DiscordEvent's shape, not by
 *    this function, since none of the event variants carry owner name,
 *    email, phone or patient data.
 */
export async function notifyDiscord(event: DiscordEvent): Promise<void> {
  const webhookUrl = webhookForEvent(event.kind)
  if (!webhookUrl) return

  try {
    after(async () => {
      try {
        const payload = buildDiscordPayload(event)
        const res = await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        if (!res.ok) {
          Sentry.captureMessage('Discord notification rejected by webhook', {
            level: 'warning',
            extra: { kind: event.kind, status: res.status },
          })
        }
      } catch (err) {
        Sentry.captureException(err, { extra: { kind: event.kind } })
      }
    })
  } catch (err) {
    // after() itself throws if called outside a request scope. Should not
    // happen from the current call sites (server actions and route
    // handlers), but a signup must never fail because of it.
    Sentry.captureException(err, { extra: { kind: event.kind, phase: 'schedule' } })
  }
}
