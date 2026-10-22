/**
 * ONE-OFF, remove after use. Apology WhatsApp for the 9 clinics stuck by the
 * Google sign-up bug (fixed in #101-#103), sent from the platform WABA.
 *
 * POST { action: 'create' | 'status' | 'send' } with `Authorization: Bearer $CRON_SECRET`.
 * GET (same auth, for a Vercel cron) runs `auto`: create if missing, send once approved.
 *
 * Every send is claimed in tenant_lifecycle_messages (unique tenant/key/channel)
 * before Meta is called, so each clinic gets it at most once, ever, and the
 * WhatsApp status webhook fills delivered/read on that row.
 */
import { NextResponse } from 'next/server'
import { and, asc, eq, inArray } from 'drizzle-orm'
import { db } from '@/db/client'
import { tenantUsers, tenants, users } from '@/db/schema'
import {
  claimLifecycleSend,
  finishLifecycleSend,
  recordSkippedLifecycleSend,
} from '@/db/queries/lifecycle'
import { handleApiError } from '@/lib/api-error'
import { ownerFirstName } from '@/lib/lifecycle-messages'
import { isCanonicalBrPhone, normalizeBrPhone } from '@/lib/phone'
import {
  createPlatformTemplate,
  findPlatformTemplate,
  sendPlatformTemplate,
  type PlatformTemplateStatus,
} from '@/lib/platform-whatsapp'

export const maxDuration = 300

const TEMPLATE_NAME = 'google_signup_fix_click'
const MESSAGE_KEY = 'google_signup_fix'
const BODY =
  'Oi, {{1}}! Identificamos um problema no cadastro com Google que pode ter impedido você de acessar a FloraClin. Já corrigimos, e pedimos desculpas! Para compensar, estendemos seu período de teste em 7 dias. É só entrar de novo pelo botão abaixo.'
const LOGIN_URL =
  'https://app.floraclin.com.br/login?utm_source=lifecycle&utm_medium=whatsapp&utm_campaign=google_signup_fix'
// Approved for today only; nothing goes out after 20:00 BRT on 2026-10-22.
const SEND_DEADLINE = new Date('2026-10-22T23:00:00Z')
const SEND_SPACING_MS = 3000
// Stop claiming new rows well before maxDuration so no claim is cut off mid-send.
const CLAIM_BUDGET_MS = 200_000

// Tenant ids only (the repo is public): names and phones are read at runtime.
const TENANT_IDS = [
  '9a58b646-242d-47c7-b865-824a89fdbd79',
  'b2c47582-c44f-4148-b43d-2643a1db2830',
  '092c7203-558f-4a16-9969-c58caf165230',
  'a47a9b46-d9df-4cef-845f-aadede3f6d05',
  'ec2b6ea4-82df-45f5-b483-156a83bac523',
  '6efe2536-5969-41b7-9640-14f8c6e6589e',
  'e15908a9-2518-4684-b90f-21c39486b82b',
  '68ae595d-12b8-47dd-9866-b613f1698c56',
  '2881ebd9-f176-4d93-83d9-d1f43e68935a',
]

const TEMPLATE_DEFINITION = {
  name: TEMPLATE_NAME,
  category: 'UTILITY' as const,
  language: 'pt_BR',
  components: [
    { type: 'BODY', text: BODY, example: { body_text: [['Ana']] } },
    { type: 'BUTTONS', buttons: [{ type: 'URL', text: 'Entrar na FloraClin', url: LOGIN_URL }] },
  ],
}

type SendResult = {
  tenantId: string
  firstName: string
  phoneLast4: string | null
  result: 'sent' | 'failed' | 'already_claimed' | 'skipped' | 'not_attempted'
  recordError?: boolean
  wamid?: string
  errorCode?: string
  reason?: string
}

const isSendable = (t: PlatformTemplateStatus | null) => t?.status === 'APPROVED' && t.category === 'UTILITY'
const last4 = (phone: string) => (phone ? phone.slice(-4) : null)
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function create(existing: PlatformTemplateStatus | null) {
  if (existing) return { created: false, template: existing }
  await createPlatformTemplate(TEMPLATE_DEFINITION)
  return { created: true, template: await findPlatformTemplate(TEMPLATE_NAME) }
}

const errorCode = (err: unknown) => {
  const message = err instanceof Error ? err.message : String(err)
  return message.match(/code=(\d+)/)?.[1] ?? (err instanceof Error ? err.name : 'unknown')
}

async function loadRecipients() {
  const [tenantRows, ownerRows] = await Promise.all([
    db
      .select({ id: tenants.id, phone: tenants.phone, deletedAt: tenants.deletedAt, optedOutAt: tenants.lifecycleOptedOutAt })
      .from(tenants)
      .where(inArray(tenants.id, TENANT_IDS)),
    db
      .select({ tenantId: tenantUsers.tenantId, fullName: users.fullName })
      .from(tenantUsers)
      .innerJoin(users, eq(users.id, tenantUsers.userId))
      .where(and(inArray(tenantUsers.tenantId, TENANT_IDS), eq(tenantUsers.role, 'owner'), eq(tenantUsers.isActive, true)))
      .orderBy(asc(tenantUsers.createdAt)),
  ])
  const owners = new Map<string, string>()
  for (const row of ownerRows) if (!owners.has(row.tenantId)) owners.set(row.tenantId, row.fullName)
  return { tenantsById: new Map(tenantRows.map((row) => [row.id, row])), owners }
}

async function sendOne(tenantId: string, firstName: string, phone: string, wait: boolean): Promise<SendResult> {
  const base = { tenantId, firstName, phoneLast4: last4(phone) }
  const claimId = await claimLifecycleSend({ tenantId, messageKey: MESSAGE_KEY, channel: 'whatsapp', recipient: phone })
  if (!claimId) return { ...base, result: 'already_claimed' }
  if (wait) await sleep(SEND_SPACING_MS)
  let metaMessageId: string
  try {
    // No automatic retry: a timed-out request may still have been delivered.
    ;({ metaMessageId } = await sendPlatformTemplate(phone, TEMPLATE_NAME, [firstName]))
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    try {
      await finishLifecycleSend(claimId, { status: 'failed', error: message })
    } catch {
      // The claim stays pending, which still blocks any resend.
    }
    return { ...base, result: 'failed', errorCode: errorCode(err) }
  }
  // Meta accepted it: never report it as failed. If the row update fails, the
  // wamid in the result/log is what fixes the row by hand.
  try {
    await finishLifecycleSend(claimId, { status: 'sent', metaMessageId })
    return { ...base, result: 'sent', wamid: metaMessageId }
  } catch {
    return { ...base, result: 'sent', wamid: metaMessageId, recordError: true }
  }
}

async function send(now: Date) {
  const template = await findPlatformTemplate(TEMPLATE_NAME)
  if (!isSendable(template)) return { sent: false, reason: 'template_not_approved_utility', template }
  if (now > SEND_DEADLINE) return { sent: false, reason: 'past_deadline', template }

  const startedAt = Date.now()
  const { tenantsById, owners } = await loadRecipients()
  const results: SendResult[] = []
  let attempted = false
  for (const tenantId of TENANT_IDS) {
    const tenant = tenantsById.get(tenantId)
    const firstName = ownerFirstName(owners.get(tenantId))
    const phone = tenant?.phone ? normalizeBrPhone(tenant.phone) : ''
    const base = { tenantId, firstName, phoneLast4: last4(phone) }
    const skipReason = !tenant || tenant.deletedAt ? 'deleted' : tenant.optedOutAt ? 'opted_out' : owners.has(tenantId) ? null : 'no_owner'
    if (skipReason) {
      results.push({ ...base, result: 'skipped', reason: skipReason })
      continue
    }
    if (Date.now() - startedAt > CLAIM_BUDGET_MS) {
      results.push({ ...base, result: 'not_attempted', reason: 'time_budget' })
      continue
    }
    try {
      if (!isCanonicalBrPhone(phone)) {
        await recordSkippedLifecycleSend({ tenantId, messageKey: MESSAGE_KEY, channel: 'whatsapp', recipient: phone || 'none', reason: 'invalid_phone' })
        results.push({ ...base, result: 'skipped', reason: 'invalid_phone' })
        continue
      }
      const result = await sendOne(tenantId, firstName, phone, attempted)
      if (result.result !== 'already_claimed') attempted = true
      results.push(result)
    } catch (err) {
      // A DB error on one clinic must not drop the results of the others.
      results.push({ ...base, result: 'failed', errorCode: `db:${errorCode(err)}` })
    }
  }
  return { sent: true, template, results }
}

async function run(action: string) {
  switch (action) {
    case 'create':
      return create(await findPlatformTemplate(TEMPLATE_NAME))
    case 'status':
      return { template: await findPlatformTemplate(TEMPLATE_NAME) }
    case 'send':
      return send(new Date())
    case 'auto': {
      const template = await findPlatformTemplate(TEMPLATE_NAME)
      if (!template) return create(null)
      if (!isSendable(template)) return { template }
      return send(new Date())
    }
    default:
      return null
  }
}

function authorized(request: Request) {
  const cronSecret = process.env.CRON_SECRET
  return Boolean(cronSecret) && request.headers.get('authorization') === `Bearer ${cronSecret}`
}

async function handle(request: Request, action: string) {
  if (!authorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const result = await run(action)
    if (!result) return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
    // Vercel keeps no response body for crons: this is the record. No phones, no Meta bodies.
    console.log('[oneoff-google-signup-fix]', JSON.stringify({ action, ...result }))
    return NextResponse.json(result)
  } catch (error) {
    return handleApiError(error, request)
  }
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { action?: unknown }
  return handle(request, typeof body.action === 'string' ? body.action : '')
}

export async function GET(request: Request) {
  return handle(request, 'auto')
}
