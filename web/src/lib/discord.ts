import { after } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { formatCurrency } from '@/lib/utils'

// Notifier for two Discord channels:
//
// - "floraclin" (DISCORD_WEBHOOK_EVENTS): business events -- the business
//   grew. signup.started / onboarding.completed / clinic.approved /
//   subscription.created / lifecycle.reply.
// - "floraclin-logs" (DISCORD_WEBHOOK_LOGS): operational digests -- code
//   reporting on itself, e.g. the daily whatsapp-automations cron digest
//   or lifecycle.template_not_approved.
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
  anamnesisFailed: number
}

export type SignupMethod = 'google' | 'email'

export type DiscordEvent =
  // Step 1 of a self sign-up: the account and its clinic exist, onboarding
  // has not been finished. Says who signed up, never the clinic name: a
  // Google sign-up only has a stand-in name at this point.
  | {
      kind: 'signup.started'
      ownerName: string
      ownerEmail: string
      method: SignupMethod
      tenantId: string
      attribution?: { utmSource?: string; utmCampaign?: string } | null
    }
  // Step 2: onboarding finished for the first time, with the clinic data the
  // owner typed there.
  | {
      kind: 'onboarding.completed'
      tenantName: string
      phone: string | null
      city: string | null
      state: string | null
      /** Already formatted, e.g. "em 4 min". */
      elapsed: string
      tenantId: string
    }
  | { kind: 'clinic.approved'; tenantName: string; tenantId: string }
  | { kind: 'subscription.created'; tenantName: string; planName: string; priceCents: number; tenantId: string }
  | { kind: 'lifecycle.reply'; tenantName: string; tenantId: string; messageKey: string; body: string }
  // A lifecycle WhatsApp was skipped (email only) because Meta does not
  // report its template as APPROVED. Sent at most once per message key per BR day.
  | {
      kind: 'lifecycle.template_not_approved'
      templateName: string
      messageKey: string
      /** Meta status (PENDING, REJECTED, PAUSED, ...) or MISSING. */
      status: string
    }
  | {
      kind: 'whatsapp_automations.digest'
      tenantsProcessed: number
      sent: number
      anamnesisSent: number
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

const COLOR_ONBOARDING_COMPLETED = 0x4a9d5f
const COLOR_SIGNUP_STARTED = 0x94a3b8
const COLOR_APPROVED = 0x3b82f6
const COLOR_SUBSCRIPTION = 0xf59e0b
const COLOR_DIGEST_OK = 0x4a9d5f
const COLOR_DIGEST_ALERT = 0xef4444
const COLOR_REPLY = 0x8b5cf6
const REPLY_BODY_MAX = 1000

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

// Discord rejects the whole post when a field value is over 1024 characters.
const INLINE_CODE_MAX = 1000

// Visitor-controlled text: inline code keeps Discord from rendering masked links or mentions.
function asInlineCode(value: string): string {
  const clean = value.replaceAll('`', '')
  const capped = clean.length > INLINE_CODE_MAX ? `${clean.slice(0, INLINE_CODE_MAX)}...` : clean
  return `\`${capped}\``
}

function adminTenantsUrl(): string {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
  return `${base}/admin/clinicas`
}

/**
 * Pure formatter: DiscordEvent -> Discord webhook payload. No I/O, so it can
 * be unit tested directly without touching fetch or env vars. The team
 * channel gets the owner's name and e-mail on signup.started and the clinic
 * phone on onboarding.completed, so a sign-up that stalls before onboarding
 * can be followed up. Patient data must never appear here because none of
 * the DiscordEvent variants carry it.
 */
export function buildDiscordPayload(event: DiscordEvent): DiscordPayload {
  const adminLink = adminTenantsUrl()

  switch (event.kind) {
    case 'signup.started': {
      const attributionFields = [
        { name: 'UTM Source', value: event.attribution?.utmSource },
        { name: 'UTM Campaign', value: event.attribution?.utmCampaign },
      ].flatMap(({ name, value }) => (value ? [{ name, value: asInlineCode(value), inline: true }] : []))
      return {
        username: 'FloraClin',
        embeds: [
          {
            title: 'Novo cadastro (onboarding pendente)',
            color: COLOR_SIGNUP_STARTED,
            fields: [
              { name: 'Nome', value: asInlineCode(event.ownerName || 'Não informado'), inline: true },
              { name: 'E-mail', value: asInlineCode(event.ownerEmail || 'Não informado'), inline: true },
              { name: 'Método', value: event.method === 'google' ? 'Google' : 'E-mail', inline: true },
              ...attributionFields,
              { name: 'Admin', value: adminLink },
            ],
            timestamp: new Date().toISOString(),
          },
        ],
      }
    }
    case 'onboarding.completed': {
      const location = [event.city, event.state].filter(Boolean).join('/')
      return {
        username: 'FloraClin',
        embeds: [
          {
            title: 'Cadastro concluído',
            color: COLOR_ONBOARDING_COMPLETED,
            description: `Onboarding concluído ${event.elapsed} após o cadastro.`,
            fields: [
              { name: 'Clínica', value: asInlineCode(event.tenantName), inline: true },
              { name: 'Telefone', value: asInlineCode(event.phone || 'Não informado'), inline: true },
              { name: 'Localização', value: location ? asInlineCode(location) : 'Não informado', inline: true },
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
    case 'lifecycle.reply': {
      const body =
        event.body.length > REPLY_BODY_MAX ? `${event.body.slice(0, REPLY_BODY_MAX)}...` : event.body
      return {
        username: 'FloraClin',
        embeds: [
          {
            title: 'Resposta de clínica em teste',
            color: COLOR_REPLY,
            description: body,
            fields: [
              { name: 'Clínica', value: event.tenantName, inline: true },
              { name: 'Mensagem', value: event.messageKey, inline: true },
              { name: 'Admin', value: adminLink },
            ],
            timestamp: new Date().toISOString(),
          },
        ],
      }
    }
    case 'lifecycle.template_not_approved': {
      return {
        username: 'FloraClin',
        embeds: [
          {
            title: 'Lifecycle: template de WhatsApp não aprovado',
            color: COLOR_DIGEST_ALERT,
            description:
              'Mensagens de lifecycle desta chave estão saindo só por e-mail. As clínicas puladas não recebem o WhatsApp depois da aprovação.',
            fields: [
              { name: 'Template', value: asInlineCode(event.templateName), inline: true },
              { name: 'Mensagem', value: asInlineCode(event.messageKey), inline: true },
              { name: 'Status na Meta', value: asInlineCode(event.status), inline: true },
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
      const totals = `${event.tenantsProcessed} clínicas processadas, ${event.sent} confirmações e ${event.anamnesisSent} links de anamnese enviados.`

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
        const detail = t.reason === 'send_failed'
          ? ` (${t.appointmentsFailed} confirmações, ${t.anamnesisFailed} links de anamnese)`
          : ''
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
  if (kind === 'whatsapp_automations.digest' || kind === 'lifecycle.template_not_approved') {
    return process.env.DISCORD_WEBHOOK_LOGS
  }
  return process.env.DISCORD_WEBHOOK_EVENTS
}

/**
 * Posts an event to its Discord channel -- "floraclin" for business events,
 * "floraclin-logs" for operational events (see webhookForEvent).
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
 * 3. It never posts patient data, enforced by DiscordEvent's shape, not by
 *    this function. The only contact data is the owner's name and e-mail
 *    (signup.started) and the clinic phone (onboarding.completed).
 *    lifecycle.reply carries the reply text a clinic owner chose to send
 *    FloraClin.
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
