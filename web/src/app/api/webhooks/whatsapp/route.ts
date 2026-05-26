import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/db/client'
import { tenants, procedureTypes, whatsappMessages } from '@/db/schema'
import { eq, and, sql } from 'drizzle-orm'
import { verifyWebhookSignature, downloadAndStoreMedia, sendTextMessage } from '@/lib/whatsapp'
import {
  upsertConversation,
  createMessage,
  incrementUnreadCount,
  updateMessageStatus,
  pushSseEvent,
  getMessageByMetaId,
  getQueuedMessages,
  updateQueuedMessageStatus,
  expireStaleQueuedMessages,
} from '@/db/queries/whatsapp'
import {
  createProspect,
  getProspectByPhone,
  updateProspect,
  logProspectActivity,
  setProspectProcedures,
} from '@/db/queries/prospects'
import { classifyMessage } from '@/lib/classify-prospect'

export const dynamic = 'force-dynamic'

// ---------------------------------------------------------------------------
// GET -- Meta verification challenge
// ---------------------------------------------------------------------------
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const mode = searchParams.get('hub.mode')
  const token = searchParams.get('hub.verify_token')
  const challenge = searchParams.get('hub.challenge')

  if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    return new Response(challenge, { status: 200 })
  }

  return NextResponse.json({ error: 'Verification failed' }, { status: 403 })
}

// ---------------------------------------------------------------------------
// POST -- Receive messages and status updates
// ---------------------------------------------------------------------------
export async function POST(request: NextRequest) {
  const rawBody = await request.text()
  const signature = request.headers.get('x-hub-signature-256') ?? ''
  const appSecret = process.env.META_APP_SECRET

  if (!appSecret || !verifyWebhookSignature(rawBody, signature, appSecret)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  let body: WebhookPayload
  try {
    body = JSON.parse(rawBody) as WebhookPayload
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const entries = body.entry ?? []

  for (const entry of entries) {
    for (const change of entry.changes ?? []) {
      if (change.field !== 'messages') continue
      const value = change.value
      const phoneNumberId = value.metadata?.phone_number_id

      if (!phoneNumberId) continue

      // Look up tenant by WhatsApp phone number ID stored in settings JSONB
      const [tenant] = await db
        .select()
        .from(tenants)
        .where(
          sql`${tenants.settings}->>'whatsapp_phone_number_id' = ${phoneNumberId}`,
        )
        .limit(1)

      if (!tenant) {
        console.warn(
          `WhatsApp webhook: unknown phone_number_id ${phoneNumberId}`,
        )
        continue
      }

      const tenantId = tenant.id

      // Process inbound messages
      for (const msg of value.messages ?? []) {
        try {
          await processInboundMessage(tenantId, msg, value.contacts?.[0])
        } catch (err) {
          console.error('Error processing WhatsApp message:', err)
        }
      }

      // Process status updates
      for (const status of value.statuses ?? []) {
        try {
          await processStatusUpdate(tenantId, status)
        } catch (err) {
          console.error('Error processing WhatsApp status:', err)
        }
      }
    }
  }

  return NextResponse.json({ success: true }, { status: 200 })
}

// ---------------------------------------------------------------------------
// Inbound message processing
// ---------------------------------------------------------------------------
async function processInboundMessage(
  tenantId: string,
  msg: WhatsAppMessage,
  contact: WhatsAppContact | undefined,
) {
  const from = msg.from
  const profileName = contact?.profile?.name
  const msgType = msg.type
  const timestamp = msg.timestamp
    ? new Date(Number(msg.timestamp) * 1000)
    : new Date()

  // Deduplicate by Meta message ID
  const metaMessageId = msg.id
  const existingMsg = await getMessageByMetaId(tenantId, metaMessageId)
  if (existingMsg) return

  // Upsert prospect
  let prospect = await getProspectByPhone(tenantId, from)
  const isNewProspect = !prospect

  if (!prospect) {
    prospect = await createProspect(tenantId, {
      phone: from,
      name: profileName,
      source: 'whatsapp',
    })
    await logProspectActivity(tenantId, prospect.id, 'created', { source: 'whatsapp', auto: true })
  }

  // Upsert conversation
  const conversation = await upsertConversation(
    tenantId,
    from,
    profileName,
    prospect.id,
  )

  // Extract message body and media info
  let body: string | null = null
  let mediaType: string | null = null
  let mediaUrl: string | null = null
  let mediaFilename: string | null = null

  if (msgType === 'text') {
    body = msg.text?.body ?? null
  } else if (['image', 'video', 'audio', 'document'].includes(msgType)) {
    const media = msg[msgType] as WhatsAppMediaPayload | undefined
    if (media) {
      mediaType = msgType
      body = media.caption ?? null
      mediaFilename = media.filename ?? `${msgType}_${metaMessageId}`

      // Fire-and-forget media download
      const mediaId = media.id
      if (mediaId) {
        downloadAndStoreMedia(tenantId, mediaId, mediaFilename)
          .then((result: { storedUrl: string }) => {
            updateMessageMedia(tenantId, metaMessageId, result.storedUrl)
          })
          .catch((err: unknown) => console.error('Media download failed:', err))
      }
    }
  }

  // Create message record
  const message = await createMessage(tenantId, conversation.id, {
    direction: 'inbound',
    metaMessageId,
    body,
    mediaType,
    mediaUrl,
    mediaFilename,
    deliveryStatus: 'delivered',
    timestamp,
  })

  // Increment unread count
  await incrementUnreadCount(tenantId, conversation.id)

  // Push SSE event for real-time UI updates
  await pushSseEvent(tenantId, 'new_message', {
    conversationId: conversation.id,
    message,
  })

  if (isNewProspect) {
    await pushSseEvent(tenantId, 'new_conversation', {
      conversation,
      prospect,
    })
  }

  // Fire-and-forget: AI classification for new prospects
  if (isNewProspect && body) {
    classifyAndUpdateProspect(tenantId, prospect.id, body).catch((err) =>
      console.error('Classification failed:', err),
    )
  }

  // Drain any queued messages now that the window is open
  drainQueuedMessages(tenantId, conversation.id, from).catch((err) =>
    console.error('Queue drain failed:', err),
  )
}

// ---------------------------------------------------------------------------
// AI prospect classification (fire-and-forget)
// ---------------------------------------------------------------------------
async function classifyAndUpdateProspect(
  tenantId: string,
  prospectId: string,
  messageBody: string,
) {
  // Fetch procedure names, IDs, and prices for keyword matching and auto-value
  const procedures = await db
    .select({ id: procedureTypes.id, name: procedureTypes.name, defaultPrice: procedureTypes.defaultPrice })
    .from(procedureTypes)
    .where(eq(procedureTypes.tenantId, tenantId))

  const procedureNames = procedures.map((p) => p.name)
  const classification = await classifyMessage(messageBody, procedureNames)

  // Match classified procedure names to actual procedure type IDs
  const matchedProcedures = classification.interestedProcedures
    .map((procName) => procedures.find((p) => p.name.toLowerCase() === procName.toLowerCase()))
    .filter((p): p is typeof procedures[number] => !!p)

  // Auto-set value by summing matched procedures' default prices
  let autoValue: string | undefined
  if (matchedProcedures.length > 0) {
    const total = matchedProcedures.reduce(
      (sum, p) => sum + (p.defaultPrice ? parseFloat(p.defaultPrice) : 0),
      0,
    )
    if (total > 0) autoValue = total.toFixed(2)

    await setProspectProcedures(tenantId, prospectId, matchedProcedures.map((p) => p.id))
  }

  await updateProspect(tenantId, prospectId, {
    intent: classification.intent,
    sentiment: classification.sentiment,
    ...(autoValue ? { value: autoValue } : {}),
    ...(classification.extractedName
      ? { name: classification.extractedName }
      : {}),
  })

  await logProspectActivity(tenantId, prospectId, 'ai_classified', {
    intent: classification.intent,
    sentiment: classification.sentiment,
    interestedProcedures: matchedProcedures.map((p) => p.name),
    ...(autoValue ? { autoValue } : {}),
  })

  // Push SSE event for prospect update
  await pushSseEvent(tenantId, 'prospect_updated', {
    prospectId,
    ...classification,
  })
}

// ---------------------------------------------------------------------------
// Media URL update after async download completes
// ---------------------------------------------------------------------------
async function updateMessageMedia(
  tenantId: string,
  metaMessageId: string,
  storedUrl: string,
) {
  await db
    .update(whatsappMessages)
    .set({ mediaUrl: storedUrl })
    .where(
      and(
        eq(whatsappMessages.tenantId, tenantId),
        eq(whatsappMessages.metaMessageId, metaMessageId),
      ),
    )
}

// ---------------------------------------------------------------------------
// Drain queued messages when window opens
// ---------------------------------------------------------------------------
async function drainQueuedMessages(
  tenantId: string,
  conversationId: string,
  phoneNumber: string,
) {
  const expiredIds = await expireStaleQueuedMessages(tenantId, conversationId)
  if (expiredIds.length > 0) {
    await pushSseEvent(tenantId, 'queue_expired', {
      conversationId,
      queuedMessageIds: expiredIds,
    })
  }

  const queued = await getQueuedMessages(tenantId, conversationId)
  if (queued.length === 0) return

  const drainedMessages: Array<{ id: string; metaMessageId: string; deliveryStatus: string }> = []

  for (const qm of queued) {
    try {
      if (!qm.body) {
        await updateQueuedMessageStatus(tenantId, qm.id, 'expired')
        continue
      }

      const result = await sendTextMessage(tenantId, phoneNumber, qm.body)

      await createMessage(tenantId, conversationId, {
        direction: 'outbound',
        metaMessageId: result.metaMessageId,
        body: qm.body,
        deliveryStatus: 'sent',
      })

      await updateQueuedMessageStatus(tenantId, qm.id, 'sent')

      drainedMessages.push({
        id: qm.id,
        metaMessageId: result.metaMessageId,
        deliveryStatus: 'sent',
      })
    } catch (err) {
      console.error(`Failed to drain queued message ${qm.id}:`, err)
    }
  }

  if (drainedMessages.length > 0) {
    await pushSseEvent(tenantId, 'queue_drained', {
      conversationId,
      messages: drainedMessages,
    })
  }
}

// ---------------------------------------------------------------------------
// Status update processing (sent, delivered, read, failed)
// ---------------------------------------------------------------------------
async function processStatusUpdate(
  tenantId: string,
  status: WhatsAppStatus,
) {
  const metaMessageId = status.id
  const statusValue = status.status

  const statusMap: Record<string, string> = {
    sent: 'sent',
    delivered: 'delivered',
    read: 'read',
    failed: 'failed',
  }

  const mappedStatus = statusMap[statusValue]
  if (!mappedStatus || !metaMessageId) return

  const errorCode =
    statusValue === 'failed'
      ? (status.errors?.[0]?.code ?? null)
      : null

  const updated = await updateMessageStatus(
    tenantId,
    metaMessageId,
    mappedStatus,
    errorCode,
  )

  if (updated) {
    await pushSseEvent(tenantId, 'status_update', {
      metaMessageId,
      status: mappedStatus,
      conversationId: updated.conversationId,
    })
  }
}

// ---------------------------------------------------------------------------
// Type definitions for Meta WhatsApp webhook payload
// ---------------------------------------------------------------------------
interface WebhookPayload {
  object: string
  entry?: WebhookEntry[]
}

interface WebhookEntry {
  id: string
  changes?: WebhookChange[]
}

interface WebhookChange {
  field: string
  value: {
    messaging_product: string
    metadata?: { phone_number_id?: string; display_phone_number?: string }
    contacts?: WhatsAppContact[]
    messages?: WhatsAppMessage[]
    statuses?: WhatsAppStatus[]
  }
}

interface WhatsAppContact {
  wa_id: string
  profile?: { name?: string }
}

interface WhatsAppMessage {
  id: string
  from: string
  timestamp: string
  type: string
  text?: { body: string }
  image?: WhatsAppMediaPayload
  video?: WhatsAppMediaPayload
  audio?: WhatsAppMediaPayload
  document?: WhatsAppMediaPayload
  [key: string]: unknown
}

interface WhatsAppMediaPayload {
  id: string
  caption?: string
  filename?: string
  mime_type?: string
  sha256?: string
}

interface WhatsAppStatus {
  id: string
  status: string
  timestamp: string
  recipient_id: string
  errors?: Array<{ code: string; title?: string }>
}
