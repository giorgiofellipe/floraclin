import crypto from 'crypto'
import { getTenant } from '@/db/queries/tenants'

export { normalizeBrPhone } from '@/lib/phone'

const GRAPH_API_VERSION = 'v21.0'
const GRAPH_API_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`

export type WhatsAppMode = 'floraclin' | 'own'

export class CreditExhaustedError extends Error {
  creditsUsed: number
  creditsTotal: number

  constructor(creditsUsed: number, creditsTotal: number) {
    super(`WhatsApp credits exhausted (${creditsUsed}/${creditsTotal})`)
    this.name = 'CreditExhaustedError'
    this.creditsUsed = creditsUsed
    this.creditsTotal = creditsTotal
  }
}

interface WhatsAppCredentials {
  phoneNumberId: string
  accessToken: string
  businessAccountId: string
}

// WhatsApp is always available on the shared FloraClin mode (the default);
// the whatsapp_enabled flag only gates tenants using their own number.
export function isWhatsAppEnabled(settings: Record<string, unknown> | null | undefined): boolean {
  const mode = (settings?.whatsapp_mode as WhatsAppMode) ?? 'floraclin'
  if (mode === 'floraclin') return true
  return !!settings?.whatsapp_enabled
}

/**
 * True when the tenant manages its own Meta templates. Clinics on the shared
 * FloraClin number must not reach any template mutation: the templates there
 * are platform-owned and live in a WABA every other clinic sends from, so
 * hiding the buttons is not enough — the routes have to refuse.
 */
export function canManageTemplates(
  settings: Record<string, unknown> | null | undefined,
): boolean {
  return ((settings?.whatsapp_mode as WhatsAppMode) ?? 'floraclin') === 'own'
}

export async function getWhatsAppMode(tenantId: string): Promise<WhatsAppMode> {
  const tenant = await getTenant(tenantId)
  if (!tenant) throw new Error('Tenant not found')
  const settings = tenant.settings as Record<string, unknown> | null
  return (settings?.whatsapp_mode as WhatsAppMode) ?? 'floraclin'
}

async function getCredentials(tenantId: string): Promise<WhatsAppCredentials> {
  const tenant = await getTenant(tenantId)
  if (!tenant) throw new Error('Tenant not found')
  const settings = tenant.settings as Record<string, unknown> | null
  const mode = (settings?.whatsapp_mode as WhatsAppMode) ?? 'floraclin'

  if (mode === 'own') {
    if (!settings?.whatsapp_enabled) throw new Error('WhatsApp not enabled')
    const phoneNumberId = settings.whatsapp_phone_number_id as string
    const accessToken = settings.whatsapp_access_token as string
    const businessAccountId = settings.whatsapp_business_account_id as string
    if (!phoneNumberId || !accessToken || !businessAccountId)
      throw new Error('WhatsApp credentials missing (phoneNumberId, accessToken, or businessAccountId)')
    return { phoneNumberId, accessToken, businessAccountId }
  }

  const phoneNumberId = process.env.FLORACLIN_WA_PHONE_NUMBER_ID
  const accessToken = process.env.FLORACLIN_WA_ACCESS_TOKEN
  const businessAccountId = process.env.FLORACLIN_WA_BUSINESS_ACCOUNT_ID
  if (!phoneNumberId || !accessToken || !businessAccountId)
    throw new Error('FloraClin shared WhatsApp credentials not configured (FLORACLIN_WA_* env vars)')
  return { phoneNumberId, accessToken, businessAccountId }
}

async function graphFetch(path: string, token: string, options?: RequestInit) {
  const res = await fetch(`${GRAPH_API_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  })
  const data = await res.json()
  if (!res.ok) {
    const err = data?.error
    const details = [
      err?.message,
      err?.error_user_msg,
      err?.error_subcode && `subcode=${err.error_subcode}`,
      err?.code && `code=${err.code}`,
    ]
      .filter(Boolean)
      .join(' | ')
    throw new Error(`Meta API error: ${details || 'Unknown error'}`)
  }
  return data
}

// Every outbound send is subscription-gated here, at the single choke
// point, so non-inbox senders (cron, webhooks, consent/anamnesis links,
// queued-message drain) cannot bypass the block. Queued messages simply
// stay pending and deliver after the tenant resubscribes.
async function requireSendAllowed(tenantId: string) {
  const { requireActiveSubscription } = await import('@/lib/plans')
  await requireActiveSubscription(tenantId)
}

export async function sendTextMessage(tenantId: string, to: string, body: string) {
  await requireSendAllowed(tenantId)
  const creds = await getCredentials(tenantId)
  const data = await graphFetch(`/${creds.phoneNumberId}/messages`, creds.accessToken, {
    method: 'POST',
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body },
    }),
  })
  return { metaMessageId: data.messages?.[0]?.id as string }
}

export async function sendTemplateMessage(
  tenantId: string,
  to: string,
  templateName: string,
  language: string,
  params?: Record<string, string>,
  buttonParams?: { index: number; subType: string; parameters: { type: string; text: string }[] }[],
) {
  await requireSendAllowed(tenantId)
  const mode = await getWhatsAppMode(tenantId)

  if (mode === 'floraclin') {
    const { consumeCredit } = await import('@/db/queries/whatsapp-credits')
    const result = await consumeCredit(tenantId, to)
    if (!result.allowed) {
      throw new CreditExhaustedError(result.creditsUsed, result.creditsTotal)
    }
  }

  const creds = await getCredentials(tenantId)
  const components: Record<string, unknown>[] = []
  if (params && Object.keys(params).length > 0) {
    components.push({
      type: 'body',
      parameters: Object.values(params).map((v) => ({ type: 'text', text: v })),
    })
  }
  if (buttonParams) {
    for (const btn of buttonParams) {
      components.push({
        type: 'button',
        sub_type: btn.subType,
        index: btn.index,
        parameters: btn.parameters,
      })
    }
  }
  const data = await graphFetch(`/${creds.phoneNumberId}/messages`, creds.accessToken, {
    method: 'POST',
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: {
        name: templateName,
        language: { code: language },
        components: components.length > 0 ? components : undefined,
      },
    }),
  })
  return { metaMessageId: data.messages?.[0]?.id as string }
}

export async function sendMediaMessage(
  tenantId: string,
  to: string,
  mediaType: 'image' | 'document' | 'audio' | 'video',
  mediaUrl: string,
  caption?: string,
  filename?: string,
) {
  await requireSendAllowed(tenantId)
  const creds = await getCredentials(tenantId)
  const mediaPayload: Record<string, string> = { link: mediaUrl }
  if (caption) mediaPayload.caption = caption
  // `filename` is only honored by Meta for document attachments — controls the
  // name the patient sees in the WhatsApp UI, including the `.pdf` extension.
  if (filename && mediaType === 'document') mediaPayload.filename = filename
  const data = await graphFetch(`/${creds.phoneNumberId}/messages`, creds.accessToken, {
    method: 'POST',
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: mediaType,
      [mediaType]: mediaPayload,
    }),
  })
  return { metaMessageId: data.messages?.[0]?.id as string }
}

export async function sendOrEnqueueDocument(
  tenantId: string,
  to: string,
  patientFirstName: string,
  mediaUrl: string,
  caption: string,
  filename: string,
  storagePath?: string,
) {
  const {
    getConversationByPhone,
    getQueuedCount,
    createQueuedMessage,
    createMessage,
  } = await import('@/db/queries/whatsapp')

  const conversation = await getConversationByPhone(tenantId, to)

  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)
  const windowOpen = conversation?.lastInboundAt
    ? conversation.lastInboundAt > twentyFourHoursAgo
    : false

  // Window open → send directly
  if (windowOpen && conversation) {
    const result = await sendMediaMessage(tenantId, to, 'document', mediaUrl, caption, filename)
    await createMessage(tenantId, conversation.id, {
      direction: 'outbound',
      metaMessageId: result.metaMessageId,
      body: caption,
      mediaType: 'document',
      mediaUrl: storagePath ? `/api/whatsapp/media?path=${encodeURIComponent(storagePath)}` : mediaUrl,
      mediaFilename: filename,
      deliveryStatus: 'sent',
    })
    return { sent: true, metaMessageId: result.metaMessageId }
  }

  // No conversation exists yet — send template only, document must wait for patient reply
  if (!conversation) {
    const resumeTemplate = await getTemplateForTenant(tenantId, 'resume_conversation')
    if (resumeTemplate?.status === 'APPROVED') {
      await sendTemplateMessage(tenantId, to, resumeTemplate.name, resumeTemplate.language, { '1': patientFirstName })
    }
    return { queued: true }
  }

  // Window closed — check queue
  const queueCount = await getQueuedCount(tenantId, conversation.id)

  if (queueCount === 0) {
    // First message when window is closed → send resume template
    const resumeTemplate = await getTemplateForTenant(tenantId, 'resume_conversation')
    let resumeMetaMessageId: string | null = null
    if (resumeTemplate?.status === 'APPROVED') {
      const resumeResult = await sendTemplateMessage(tenantId, to, resumeTemplate.name, resumeTemplate.language, { '1': patientFirstName })
      resumeMetaMessageId = resumeResult.metaMessageId

      await createMessage(tenantId, conversation.id, {
        direction: 'outbound',
        metaMessageId: resumeMetaMessageId,
        body: resolveTemplateBody(resumeTemplate.components, { '1': patientFirstName }),
        templateName: resumeTemplate.name,
        deliveryStatus: 'sent',
      })
    }

    // Enqueue the document
    await createQueuedMessage(tenantId, conversation.id, {
      body: caption,
      mediaType: 'document',
      mediaUrl,
      resumeMetaMessageId,
    })
    return { queued: true }
  }

  // Queue already has messages → just enqueue
  await createQueuedMessage(tenantId, conversation.id, {
    body: caption,
    mediaType: 'document',
    mediaUrl,
  })
  return { queued: true }
}

export async function getTemplates(tenantId: string) {
  const creds = await getCredentials(tenantId)
  const data = await graphFetch(
    `/${creds.businessAccountId}/message_templates?fields=name,language,category,status,components,rejected_reason&limit=100`,
    creds.accessToken,
  )
  return (data.data ?? []) as Array<{
    id: string
    name: string
    language: string
    category: string
    status: string
    components: unknown[]
    rejected_reason?: string | null
  }>
}

export async function getTemplateForTenant(
  tenantId: string,
  purposeKey: string,
) {
  const mode = await getWhatsAppMode(tenantId)
  const { getTemplateByPurpose } = await import('@/db/queries/whatsapp')
  if (mode === 'floraclin') {
    return getSystemTemplate(purposeKey)
  }
  return getTemplateByPurpose(tenantId, purposeKey)
}

export interface TemplateSyncResult {
  synced: number
  skipped: number
  removed: number
}

/**
 * Pulls templates from Meta for the tenant's WABA and upserts only the ones
 * that belong to this tenant, per `belongsToTemplatePrefix`. The WABA is
 * shared across every tenant on FloraClin, so the Meta response includes
 * every other clinic's templates too, and those are skipped, not imported.
 *
 * `markStaleTemplates` is fed the same filtered id list used for the upsert,
 * so it marks every local row outside this prefix DELETED — including rows
 * imported from another clinic by the old unfiltered sync, which is the
 * point. System rows are the exception and are excluded inside the query:
 * a tenant sync never sees them and so is never evidence that a
 * platform-managed template is gone.
 */
export async function syncTemplatesForTenant(
  tenantId: string,
  prefix: string,
): Promise<TemplateSyncResult> {
  const { upsertTemplate, markStaleTemplates } = await import('@/db/queries/whatsapp')
  const { belongsToTemplatePrefix } = await import('@/lib/whatsapp-blueprints')

  const metaTemplates = await getTemplates(tenantId)
  const ownTemplates = metaTemplates.filter((tpl) => belongsToTemplatePrefix(tpl.name, prefix))
  const skipped = metaTemplates.length - ownTemplates.length

  let synced = 0
  for (const tpl of ownTemplates) {
    await upsertTemplate(tenantId, {
      metaTemplateId: tpl.id,
      name: tpl.name,
      language: tpl.language,
      category: tpl.category,
      status: tpl.status,
      components: tpl.components,
      rejectedReason: tpl.rejected_reason ?? null,
    })
    synced++
  }

  const metaIds = ownTemplates.map((tpl) => tpl.id)
  const removed = await markStaleTemplates(tenantId, metaIds)

  return { synced, skipped, removed }
}

async function getSystemTemplate(purposeKey: string) {
  const { db } = await import('@/db/client')
  const { whatsappTemplates } = await import('@/db/schema')
  const { eq, and } = await import('drizzle-orm')

  const [template] = await db
    .select()
    .from(whatsappTemplates)
    .where(
      and(
        eq(whatsappTemplates.systemTemplate, true),
        eq(whatsappTemplates.purposeKey, purposeKey),
      ),
    )
    .limit(1)

  return template ?? null
}

export async function createTemplate(
  tenantId: string,
  template: {
    name: string
    category: string
    language: string
    components: unknown[]
  },
) {
  const creds = await getCredentials(tenantId)
  const data = await graphFetch(
    `/${creds.businessAccountId}/message_templates`,
    creds.accessToken,
    {
      method: 'POST',
      body: JSON.stringify({
        name: template.name,
        category: template.category,
        language: template.language,
        components: template.components,
      }),
    },
  )
  return data as { id: string; status: string; category: string }
}

export async function editTemplate(
  tenantId: string,
  metaTemplateId: string,
  components: unknown[],
) {
  const creds = await getCredentials(tenantId)
  const data = await graphFetch(`/${metaTemplateId}`, creds.accessToken, {
    method: 'POST',
    body: JSON.stringify({ components }),
  })
  return data as { success: boolean }
}

export async function deleteTemplate(
  tenantId: string,
  templateName: string,
) {
  const creds = await getCredentials(tenantId)
  const data = await graphFetch(
    `/${creds.businessAccountId}/message_templates?name=${encodeURIComponent(templateName)}`,
    creds.accessToken,
    { method: 'DELETE' },
  )
  return data as { success: boolean }
}

export async function getTemplate(
  tenantId: string,
  metaTemplateId: string,
) {
  const creds = await getCredentials(tenantId)
  const data = await graphFetch(
    `/${metaTemplateId}?fields=name,status,category,components,rejected_reason`,
    creds.accessToken,
  )
  return data as {
    id: string
    name: string
    status: string
    category: string
    components: unknown[]
    rejected_reason?: string
  }
}

export async function downloadAndStoreMedia(
  tenantId: string,
  mediaId: string,
  filename: string,
): Promise<{ storedUrl: string; mimeType: string }> {
  const creds = await getCredentials(tenantId)
  const meta = await graphFetch(`/${mediaId}`, creds.accessToken)
  const mediaUrl = meta.url as string
  const res = await fetch(mediaUrl, {
    headers: { Authorization: `Bearer ${creds.accessToken}` },
  })
  if (!res.ok) throw new Error('Failed to download media')
  const buffer = Buffer.from(await res.arrayBuffer())
  const mimeType = res.headers.get('content-type') ?? 'application/octet-stream'

  const { createClient } = await import('@supabase/supabase-js')
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
  const path = `whatsapp/${tenantId}/${mediaId}/${filename}`
  const { error } = await supabase.storage
    .from('media')
    .upload(path, buffer, { contentType: mimeType, upsert: true })
  if (error) throw new Error(`Storage upload failed: ${error.message}`)
  const { data: urlData } = supabase.storage.from('media').getPublicUrl(path)
  return { storedUrl: urlData.publicUrl, mimeType }
}

export async function verifyCredentials(phoneNumberId: string, token: string) {
  try {
    const data = await graphFetch(`/${phoneNumberId}`, token)
    return { valid: true, phoneDisplay: data.display_phone_number as string | undefined }
  } catch (err) {
    console.error('WhatsApp credential verification failed:', err instanceof Error ? err.message : err)
    return { valid: false, phoneDisplay: undefined }
  }
}

export function verifyWebhookSignature(
  payload: string,
  signature: string,
  appSecret: string,
): boolean {
  const expectedBuf = Buffer.from(
    `sha256=${crypto.createHmac('sha256', appSecret).update(payload).digest('hex')}`,
  )
  const actualBuf = Buffer.from(signature)
  if (expectedBuf.length !== actualBuf.length) return false
  return crypto.timingSafeEqual(expectedBuf, actualBuf)
}

export function resolveTemplateBody(
  components: unknown,
  params?: Record<string, string>,
): string | null {
  if (!Array.isArray(components)) return null
  const bodyComp = components.find(
    (c: Record<string, unknown>) => c.type === 'BODY',
  ) as { text?: string } | undefined
  if (!bodyComp?.text) return null
  let text = bodyComp.text
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      text = text.replaceAll(`{{${key}}}`, value)
    }
  }
  return text
}
