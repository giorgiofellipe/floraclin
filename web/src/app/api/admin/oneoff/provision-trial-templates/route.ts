/**
 * ONE-OFF, remove after use. Provisions the five trial lifecycle WhatsApp
 * templates on the FloraClin platform WABA from inside Vercel (the only place
 * with the prod FLORACLIN_WA_* credentials), and deletes the retired
 * `trial_ending_click` (PR #94 release step).
 *
 * GET (Vercel cron) or POST (manual), `Authorization: Bearer $CRON_SECRET`.
 * Idempotent: a template that exists on Meta in any status is only reported,
 * so after the first successful run every later run just reports status.
 */
import { NextResponse } from 'next/server'
import { handleApiError } from '@/lib/api-error'
import { LIFECYCLE_MESSAGES, type LifecycleMessageKey } from '@/lib/lifecycle-messages'
import { buildLifecycleTemplateDefinition } from '@/lib/lifecycle-templates'
import { createPlatformTemplate } from '@/lib/platform-whatsapp'
import { deleteTemplate, findTemplate, type MetaTemplate } from './meta'

export const maxDuration = 120

const LOG_PREFIX = '[oneoff-provision-trial-templates]'
const KEYS: LifecycleMessageKey[] = ['trial_last_day', 'trial_ending_soon', 'trial_winback', 'trial_help', 'trial_final']
const RETIRED_TEMPLATE = 'trial_ending_click'

type TemplateAction = 'created' | 'exists' | 'create_failed' | 'lookup_failed'
type RetiredAction = 'deleted' | 'absent' | 'delete_failed' | 'skipped_still_referenced'

type TemplateResult = {
  name: string
  id: string | null
  status: string | null
  category: string | null
  rejectedReason: string | null
  action: TemplateAction
  error?: string
}

type Summary = {
  templates: TemplateResult[]
  retired: { name: string; action: RetiredAction; error?: string }
}

function trialMessages() {
  return KEYS.map((key) => {
    const message = LIFECYCLE_MESSAGES.find((m) => m.key === key)
    if (!message || message.templateName !== `${key}_click`)
      throw new Error(`Unexpected lifecycle message for ${key}: ${message?.templateName ?? 'missing'}`)
    return message
  })
}

// Meta error messages carry no token, but never let one through by accident.
function errorMessage(err: unknown) {
  let message = err instanceof Error ? err.message : String(err)
  const token = process.env.FLORACLIN_WA_ACCESS_TOKEN
  if (token) message = message.replaceAll(token, '[redacted]')
  return message.slice(0, 300)
}

const fromMeta = (t: MetaTemplate) => ({
  id: t.id,
  status: t.status,
  category: t.category,
  rejectedReason: t.rejectedReason,
})
const EMPTY = { id: null, status: null, category: null, rejectedReason: null }

async function provision(message: (typeof LIFECYCLE_MESSAGES)[number], appUrl: string): Promise<TemplateResult> {
  const name = message.templateName
  let existing: MetaTemplate | null
  try {
    existing = await findTemplate(name)
  } catch (err) {
    return { name, ...EMPTY, action: 'lookup_failed', error: errorMessage(err) }
  }
  if (existing) return { name, ...fromMeta(existing), action: 'exists' }
  try {
    const created = await createPlatformTemplate(buildLifecycleTemplateDefinition(message, appUrl))
    return {
      name,
      ...EMPTY,
      id: created.id ?? null,
      status: created.status ?? null,
      category: created.category ?? message.category,
      action: 'created',
    }
  } catch (err) {
    return { name, ...EMPTY, action: 'create_failed', error: errorMessage(err) }
  }
}

async function retire(): Promise<Summary['retired']> {
  const name = RETIRED_TEMPLATE
  if (LIFECYCLE_MESSAGES.some((m) => m.templateName === name)) return { name, action: 'skipped_still_referenced' }
  try {
    const existing = await findTemplate(name)
    // A delete already in flight (or done) must not be issued again.
    if (!existing || existing.status === 'PENDING_DELETION' || existing.status === 'DELETED')
      return { name, action: 'absent' }
    await deleteTemplate(name)
    return { name, action: 'deleted' }
  } catch (err) {
    return { name, action: 'delete_failed', error: errorMessage(err) }
  }
}

function shouldNotify(summary: Summary, now: Date) {
  const changed = summary.templates.some((t) => t.action === 'created') || summary.retired.action === 'deleted'
  // Everything else, failures included, waits for the hourly heartbeat (the cron
  // runs every 15 minutes) so a lasting failure does not post four times an hour.
  return changed || now.getUTCMinutes() < 15
}

async function notifyDiscord(summary: Summary) {
  const webhookUrl = process.env.DISCORD_WEBHOOK_LOGS
  if (!webhookUrl) return
  const lines = summary.templates.map((t) => {
    const reason = t.rejectedReason && t.rejectedReason !== 'NONE' ? `, ${t.rejectedReason}` : ''
    return `- ${t.name} [${t.id ?? '?'}]: ${t.status ?? '?'} ${t.category ?? '?'} (${t.action}${reason})`
  })
  lines.push(`- ${summary.retired.name}: ${summary.retired.action}`)
  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'FloraClin', content: `Templates de trial (one-off)\n${lines.join('\n')}` }),
      signal: AbortSignal.timeout(5_000),
    })
    if (!res.ok) console.warn(LOG_PREFIX, `Discord webhook returned HTTP ${res.status}`)
  } catch {
    // Discord is best-effort; the log line is the record.
  }
}

function authorized(request: Request) {
  const cronSecret = process.env.CRON_SECRET
  return Boolean(cronSecret) && request.headers.get('authorization') === `Bearer ${cronSecret}`
}

// The button URL is permanent once Meta approves the template, so only accept
// a public https origin, without trailing slashes.
function appUrlProblem(appUrl: string | undefined) {
  if (!appUrl) return 'NEXT_PUBLIC_APP_URL is not set'
  let url: URL
  try {
    url = new URL(appUrl)
  } catch {
    return 'NEXT_PUBLIC_APP_URL is not a valid URL'
  }
  if (url.protocol !== 'https:') return 'NEXT_PUBLIC_APP_URL must be an https URL'
  if (['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.hostname.endsWith('.localhost'))
    return 'NEXT_PUBLIC_APP_URL must not point to localhost'
  return null
}

async function handle(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/+$/, '')
  const problem = appUrlProblem(appUrl)
  if (problem || !appUrl) {
    console.error(LOG_PREFIX, problem)
    return NextResponse.json({ error: problem }, { status: 500 })
  }
  try {
    const messages = trialMessages()
    // In parallel (results keep KEYS order) so the worst case stays well below maxDuration.
    const templates = await Promise.all(messages.map((message) => provision(message, appUrl)))
    const summary: Summary = { templates, retired: await retire() }
    // Vercel keeps no response body for crons: this line is the record.
    console.log(LOG_PREFIX, JSON.stringify(summary))
    if (shouldNotify(summary, new Date())) await notifyDiscord(summary)
    return NextResponse.json(summary)
  } catch (error) {
    return handleApiError(error, request)
  }
}

export async function GET(request: Request) {
  return handle(request)
}

export async function POST(request: Request) {
  return handle(request)
}
