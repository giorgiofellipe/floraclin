import { NextRequest, NextResponse, after } from 'next/server'
import { db } from '@/db/client'
import { tenants, procedureTypes, whatsappMessages, whatsappConversations } from '@/db/schema'
import { eq, and, sql } from 'drizzle-orm'
import { verifyWebhookSignature, downloadAndStoreMedia, sendTextMessage, sendTemplateMessage, sendMediaMessage, normalizeBrPhone, getTemplateForTenant } from '@/lib/whatsapp'
import {
  upsertConversation,
  createMessage,
  incrementUnreadCount,
  updateMessageStatus,
  pushSseEvent,
  getMessageByMetaId,
  getRecentInboundBodies,
  getQueuedMessages,
  updateQueuedMessageStatus,
  expireStaleQueuedMessages,
  listAutomations,
} from '@/db/queries/whatsapp'
import {
  getAppointmentByConfirmationMessageId,
  confirmAppointment,
  requestReschedule,
} from '@/db/queries/appointments'
import { getAnamnesis } from '@/db/queries/anamnesis'
import { createAnamnesisToken } from '@/db/queries/anamnesis-tokens'
import {
  createNewProspect,
  getProspectByPhone,
  updateProspect,
  logProspectActivity,
  setProspectProcedures,
} from '@/db/queries/prospects'
import { getPatientByPhone, getPatient } from '@/db/queries/patients'
import { getTenant } from '@/db/queries/tenants'
import { classifyMessage } from '@/lib/classify-prospect'
import { toWhatsAppPhone } from '@/lib/phone'
import { reportSideEffectFailure } from '@/lib/observability'
import { parseReferral } from '@/lib/meta/attribution'
import { recordAttribution } from '@/db/queries/lead-attributions'
import { enqueueMetaEvent } from '@/lib/meta/events'

export const dynamic = 'force-dynamic'

// Meta retries a webhook only when the whole request fails, so every one of
// these handlers swallows its error on purpose: one bad message must not cost
// us the rest of the batch, or make Meta replay the batch forever. Swallowed
// is not the same as invisible, though. A patient reply that never lands in
// the inbox is exactly the failure a clinic notices before we do, and a
// `console.error` on Vercel is not something anyone reads.
function reportWebhookFailure(
  error: unknown,
  step: string,
  extra?: Record<string, unknown>,
) {
  reportSideEffectFailure(error, { area: 'whatsapp-webhook', step, extra })
}

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

      const isSharedNumber =
        phoneNumberId === process.env.FLORACLIN_WA_PHONE_NUMBER_ID

      if (isSharedNumber) {
        for (const msg of value.messages ?? []) {
          try {
            const senderPhone = normalizeBrPhone(msg.from)
            const contextMessageId = msg.context?.id
            const tenantId = await resolveSharedNumberTenant(senderPhone, contextMessageId)
            // The resolver logs or reports why it refused, so nothing to
            // add here beyond skipping the message.
            if (!tenantId) continue
            await processInboundMessage(tenantId, msg, value.contacts?.[0])
          } catch (err) {
            reportWebhookFailure(err, 'inbound_message_shared')
          }
        }

        for (const status of value.statuses ?? []) {
          try {
            const recipientPhone = normalizeBrPhone(status.recipient_id)
            // status.id is Meta's id of the outbound message the status refers
            // to -- an exact key into whatsapp_messages, so try it first.
            const tenantId = await resolveSharedNumberTenant(recipientPhone, status.id)
            if (!tenantId) continue
            await processStatusUpdate(tenantId, status)
          } catch (err) {
            reportWebhookFailure(err, 'status_update_shared')
          }
        }

        continue
      }

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
          reportWebhookFailure(err, 'inbound_message', { tenantId })
        }
      }

      // Process status updates
      for (const status of value.statuses ?? []) {
        try {
          await processStatusUpdate(tenantId, status)
        } catch (err) {
          reportWebhookFailure(err, 'status_update', { tenantId })
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
  const from = normalizeBrPhone(msg.from)
  const profileName = contact?.profile?.name
  const msgType = msg.type
  const timestamp = msg.timestamp
    ? new Date(Number(msg.timestamp) * 1000)
    : new Date()

  // Deduplicate by Meta message ID
  const metaMessageId = msg.id
  const existingMsg = await getMessageByMetaId(tenantId, metaMessageId)
  if (existingMsg) return

  // Upsert prospect — create a new lead if old one is in a terminal stage
  let prospect = await getProspectByPhone(tenantId, from)
  let isNewProspect = !prospect

  if (!prospect || prospect.stage === 'convertido' || prospect.stage === 'perdido') {
    const previousProspectId = prospect?.id
    prospect = await createNewProspect(tenantId, {
      phone: from,
      name: profileName,
      source: 'whatsapp',
    })
    isNewProspect = true
    await logProspectActivity(tenantId, prospect.id, 'created', {
      source: 'whatsapp',
      auto: true,
      ...(previousProspectId ? { previousProspectId } : {}),
    })
  }

  // Every inbound message gets exactly one attribution row, whether or not
  // this is a new prospect: an existing lead may still be missing its first
  // observed ad click, and organic WhatsApp leads need a row too so they
  // appear in the funnel instead of vanishing from it. The unique index on
  // prospectId makes a repeat call a no-op (first touch wins). Caught locally
  // like the other side effects in this file: losing an attribution row must
  // never cost us the message itself.
  try {
    const referral = parseReferral(msg.referral)
    await recordAttribution({
      tenantId,
      prospectId: prospect.id,
      channel: referral?.ctwaClid ? 'ctwa' : 'organic',
      ctwaClid: referral?.ctwaClid ?? null,
      adId: referral?.adId ?? null,
      adHeadline: referral?.adHeadline ?? null,
      sourceUrl: referral?.sourceUrl ?? null,
    })
  } catch (err) {
    reportWebhookFailure(err, 'lead_attribution', { tenantId })
  }

  // Match to existing patient by phone
  const patient = await getPatientByPhone(tenantId, from)

  // Emitted here and not next to createNewProspect: enqueueMetaEvent reads the
  // attribution row at call time, so a Lead enqueued before recordAttribution
  // reaches Meta with no ctwa_clid and no ad id, which is the whole match.
  if (isNewProspect) {
    await enqueueMetaEvent({
      tenantId,
      eventName: 'Lead',
      eventId: `lead:${prospect.id}`,
      eventTime: timestamp,
      prospectId: prospect.id,
      patientId: patient?.id ?? null,
      actionSource: 'business_messaging',
      contact: { phone: from, fullName: profileName },
    })
  }

  // Upsert conversation
  const conversation = await upsertConversation(
    tenantId,
    from,
    profileName,
    prospect.id,
    patient?.id ?? null,
  )

  // Extract message body and media info
  let body: string | null = null
  let mediaType: string | null = null
  let mediaUrl: string | null = null
  let mediaFilename: string | null = null

  if (msgType === 'text') {
    body = msg.text?.body ?? null
  } else if (msgType === 'interactive') {
    const interactive = msg.interactive as { button_reply?: { title: string }; list_reply?: { title: string; description?: string } } | undefined
    body = interactive?.button_reply?.title ?? interactive?.list_reply?.title ?? null
  } else if (msgType === 'button') {
    const button = msg.button as { text: string } | undefined
    body = button?.text ?? null
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
          .catch((err: unknown) =>
            reportWebhookFailure(err, 'media_download', { tenantId, mediaId }),
          )
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

  // Process confirmation button replies.
  //
  // A quick reply arrives in one of two shapes, and which one depends on what
  // was sent, not on what the button looks like:
  //   - tapped on a *template*    -> type 'button',      button.text
  //   - tapped on an *interactive* -> type 'interactive', interactive.button_reply.title
  // The confirmation messages are templates, so the first shape is the one
  // that matters in production. Both are read because both are reachable.
  //
  // Always the label, never the id: button_reply.id is a generated UUID.
  const interactiveData = msg.interactive as {
    type?: string
    button_reply?: { id: string; title: string }
  } | undefined
  const templateButton = msg.button as { text?: string; payload?: string } | undefined
  const buttonTitle = interactiveData?.button_reply?.title ?? templateButton?.text
  const contextMessageId = msg.context?.id

  if (buttonTitle && contextMessageId) {
    // Registered with `after` rather than left floating. Meta needs its 200
    // quickly, but a bare fire-and-forget promise can be cut off when the
    // serverless invocation freezes after the response, which would leave a
    // patient who tapped Confirmar still marked as scheduled.
    after(
      processConfirmationReply(tenantId, contextMessageId, buttonTitle, from).catch((err) => {
        reportWebhookFailure(err, 'confirmation_reply', { tenantId })
      }),
    )
  }

  // Fire-and-forget: keep reclassifying while the lead is still in "novo" stage
  if (prospect.stage === 'novo') {
    // Subtract 60s buffer from prospect createdAt to account for clock difference
    // between WhatsApp msg timestamp and DB NOW(). Only matters for new prospects;
    // for existing ones the createdAt is old enough that 60s is irrelevant.
    const classifyAfter = new Date(new Date(prospect.createdAt).getTime() - 60_000)
    classifyAndUpdateProspect(tenantId, prospect.id, conversation.id, classifyAfter).catch((err) =>
      reportWebhookFailure(err, 'prospect_classification', { tenantId }),
    )
  }

  // Drain any queued messages now that the window is open
  drainQueuedMessages(tenantId, conversation.id, from).catch((err) =>
    reportWebhookFailure(err, 'queue_drain', { tenantId }),
  )
}

// ---------------------------------------------------------------------------
// AI prospect classification (fire-and-forget)
// ---------------------------------------------------------------------------
async function classifyAndUpdateProspect(
  tenantId: string,
  prospectId: string,
  conversationId: string,
  prospectCreatedAt: Date,
) {
  const [procedures, recentMessages] = await Promise.all([
    db
      .select({ id: procedureTypes.id, name: procedureTypes.name, defaultPrice: procedureTypes.defaultPrice })
      .from(procedureTypes)
      .where(eq(procedureTypes.tenantId, tenantId)),
    getRecentInboundBodies(conversationId, 5, prospectCreatedAt),
  ])

  if (recentMessages.length === 0) return

  const procedureNames = procedures.map((p) => p.name)
  const classification = await classifyMessage(recentMessages, procedureNames)

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

  const drainedQueueIds: string[] = []

  for (const qm of queued) {
    try {
      if (!qm.body && !qm.mediaUrl) {
        await updateQueuedMessageStatus(tenantId, qm.id, 'expired')
        drainedQueueIds.push(qm.id)
        continue
      }

      let result: { metaMessageId: string }
      if (qm.mediaUrl && qm.mediaType) {
        result = await sendMediaMessage(tenantId, phoneNumber, qm.mediaType as 'document', qm.mediaUrl, qm.body ?? undefined)
      } else {
        result = await sendTextMessage(tenantId, phoneNumber, qm.body!)
      }

      const sentMessage = await createMessage(tenantId, conversationId, {
        direction: 'outbound',
        metaMessageId: result.metaMessageId,
        body: qm.body,
        mediaType: qm.mediaType,
        mediaUrl: qm.mediaUrl,
        deliveryStatus: 'sent',
      })

      await updateQueuedMessageStatus(tenantId, qm.id, 'sent')
      drainedQueueIds.push(qm.id)

      await pushSseEvent(tenantId, 'new_message', {
        conversationId,
        message: sentMessage,
      })
    } catch (err) {
      reportWebhookFailure(err, 'queue_drain_message', { tenantId, queuedMessageId: qm.id })
    }
  }

  if (drainedQueueIds.length > 0) {
    await pushSseEvent(tenantId, 'queue_drained', {
      conversationId,
      queuedMessageIds: drainedQueueIds,
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
// Shared-number tenant resolution
//
// Multiple tenants can share the FloraClin WhatsApp number. When an inbound
// message or status update arrives, we must not guess which tenant it
// belongs to -- routing it to the wrong tenant exposes one clinic's patient
// to another clinic's inbox. Resolution tries, in order:
//
//   1. Reply context / message id, scoped to the sender. A context.id (on a
//      reply) or a status' own id is only trustworthy as a routing key when
//      it names a message WE sent (direction 'outbound') to THIS sender.
//      meta_message_id is globally unique (see uq_whatsapp_messages_meta_id),
//      but unique does not mean "belongs to this conversation" -- an id
//      could name a message sent to a different phone entirely, so we join
//      to whatsapp_conversations and compare its phone_number (normalized)
//      against the sender's. Three outcomes:
//        - resolves, phone matches -> route with certainty (exact).
//        - resolves, phone MISMATCHES -> refuse and report. Do NOT fall
//          back to phone history for this request. Not because a sender
//          could forge the id (the payload is HMAC-verified and context.id
//          is set by Meta, not by the patient), but because a mismatch
//          means our own data disagrees with itself, and guessing a tenant
//          from a second signal we already know to be inconsistent is how
//          a message crosses a clinic boundary.
//        - does not resolve to an outbound message of this sender's (unknown
//          id, or the message found is inbound) -> fall through to
//          phone-history rules. This is deliberate: our own write can lose a
//          race with the reply, and refusing outright would drop legitimate
//          messages.
//   2. Phone history, only when unambiguous. No usable message id means a
//      genuinely new inbound message (a patient messaging a clinic for the
//      first time). Fall back to phone lookup, but only route when exactly
//      one tenant has ever had a conversation with that phone.
//   3. Ambiguous or zero-candidate: refuse. Two or more candidate tenants,
//      or none at all, and no message id to disambiguate -- do not guess.
//      Log and report to Sentry instead (the two reasons are distinguishable
//      by error message) so a dropped message is never silent.
// ---------------------------------------------------------------------------
type MessageIdResolution =
  | { status: 'exact'; tenantId: string }
  | { status: 'mismatch'; tenantId: string }
  | { status: 'not_found' }

// whatsapp_conversations.phone_number is stored normalized (see
// upsertConversation, which runs every write through normalizeBrPhone), but
// we normalize it again here defensively -- normalizeBrPhone is idempotent,
// and this guards against any legacy/unnormalized row causing a false
// mismatch rather than a false match.
async function resolveTenantByMessageId(
  metaMessageId: string,
  senderPhone: string,
): Promise<MessageIdResolution> {
  const [row] = await db
    .select({
      tenantId: whatsappMessages.tenantId,
      direction: whatsappMessages.direction,
      conversationPhone: whatsappConversations.phoneNumber,
    })
    .from(whatsappMessages)
    .innerJoin(
      whatsappConversations,
      eq(whatsappMessages.conversationId, whatsappConversations.id),
    )
    .where(eq(whatsappMessages.metaMessageId, metaMessageId))
    .limit(1)

  // Not one of ours, or it names a message the sender wrote (not us) -- a
  // reply's context should only ever point at something we sent.
  if (!row || row.direction !== 'outbound') return { status: 'not_found' }

  if (normalizeBrPhone(row.conversationPhone) === senderPhone) {
    return { status: 'exact', tenantId: row.tenantId }
  }

  return { status: 'mismatch', tenantId: row.tenantId }
}

/**
 * How recent a conversation has to be to break a tie between clinics.
 *
 * Only reached when the same phone has a conversation with more than one
 * clinic and the message carries no reply context. Refusing outright would
 * drop the message, and the likeliest sequence that lands here is a patient
 * confirming an appointment (which routes exactly, by context id) and then
 * typing a follow-up a moment later. One clinic being active inside this
 * window is a strong signal; two are not, and that still refuses.
 */
const AMBIGUITY_RECENCY_WINDOW_MS = 24 * 60 * 60 * 1000

async function resolveTenantByPhoneHistory(phone: string): Promise<string | null> {
  const rows = await db
    .select({
      tenantId: whatsappConversations.tenantId,
      lastMessageAt: whatsappConversations.lastMessageAt,
    })
    .from(whatsappConversations)
    .where(eq(whatsappConversations.phoneNumber, phone))

  const tenantIds = [...new Set(rows.map((r) => r.tenantId))]

  if (tenantIds.length === 1) return tenantIds[0]

  if (tenantIds.length > 1) {
    const cutoff = Date.now() - AMBIGUITY_RECENCY_WINDOW_MS
    const recentTenantIds = [
      ...new Set(
        rows
          .filter((r) => r.lastMessageAt !== null && r.lastMessageAt.getTime() >= cutoff)
          .map((r) => r.tenantId),
      ),
    ]

    if (recentTenantIds.length === 1) return recentTenantIds[0]

    // Either nothing is live or more than one clinic is. Recency cannot
    // separate them, so refuse rather than guess across a tenant boundary.
    reportWebhookFailure(
      new Error('WhatsApp shared-number: ambiguous tenant resolution'),
      'shared_tenant_ambiguous',
      { phone, candidateTenantIds: tenantIds, recentTenantIds },
    )
    return null
  }

  // No conversation for this phone under any tenant. On the shared number a
  // conversation row only exists once a clinic has messaged the person, so
  // this is every cold inbound: wrong numbers, spam, anyone who found the
  // FloraClin number. Ordinary traffic, so it logs rather than raising an
  // exception that would page through the Sentry to Discord route.
  console.warn(`WhatsApp webhook (shared): no tenant found for phone ${phone}`)
  return null
}

async function resolveSharedNumberTenant(
  phone: string,
  messageId?: string | null,
): Promise<string | null> {
  if (messageId) {
    const resolution = await resolveTenantByMessageId(messageId, phone)

    if (resolution.status === 'exact') return resolution.tenantId

    if (resolution.status === 'mismatch') {
      reportWebhookFailure(
        new Error('WhatsApp shared-number: context/sender phone mismatch'),
        'shared_context_phone_mismatch',
        { messageId, phone, tenantId: resolution.tenantId },
      )
      return null
    }

    // not_found: unknown message id (not one of ours), or it names a
    // message the sender wrote rather than one we sent -- fall through to
    // phone rules rather than dropping the message.
  }

  return resolveTenantByPhoneHistory(phone)
}

// ---------------------------------------------------------------------------
// Confirmation button reply processing
// ---------------------------------------------------------------------------
async function processConfirmationReply(
  tenantId: string,
  contextMessageId: string,
  buttonTitle: string,
  fromPhone: string,
) {
  const appointment = await getAppointmentByConfirmationMessageId(tenantId, contextMessageId)
  if (!appointment) return
  if (appointment.status !== 'scheduled') return

  if (buttonTitle === 'Confirmar') {
    const confirmed = await confirmAppointment(tenantId, appointment.id)
    if (!confirmed) return

    if (appointment.patientId) {
      await maybeAutoSendAnamnesis(tenantId, appointment.patientId, fromPhone)
    }
  } else if (buttonTitle === 'Reagendar') {
    await requestReschedule(tenantId, appointment.id)
  }
}

// ---------------------------------------------------------------------------
// Auto-send anamnesis link after confirmation (if enabled and stale)
// ---------------------------------------------------------------------------
async function maybeAutoSendAnamnesis(
  tenantId: string,
  patientId: string,
  phone: string,
) {
  const automations = await listAutomations(tenantId)
  const confirmationAuto = automations.find(
    (a) => a.trigger === 'appointment_confirmation' && a.enabled
  )
  if (!confirmationAuto) return

  const config = (confirmationAuto.config ?? {}) as Record<string, unknown>
  if (!config.autoAnamnesisEnabled) return

  const staleDays = (config.anamnesisStaleDays as number) ?? 60
  const anamnesis = await getAnamnesis(tenantId, patientId)
  if (anamnesis?.updatedAt) {
    const daysSince = (Date.now() - new Date(anamnesis.updatedAt).getTime()) / (1000 * 60 * 60 * 24)
    if (daysSince < staleDays) return
  }

  const template = await getTemplateForTenant(tenantId, 'anamnese_link')
  if (!template || template.status !== 'APPROVED') return

  const patient = await getPatient(tenantId, patientId)
  if (!patient) return

  // Create anamnesis token
  const tenant = await getTenant(tenantId)
  if (!tenant) return

  // Use a tenant owner as createdBy since the FK requires a valid user UUID
  const { db: dbClient } = await import('@/db/client')
  const { tenantUsers } = await import('@/db/schema')
  const [owner] = await dbClient
    .select({ userId: tenantUsers.userId })
    .from(tenantUsers)
    .where(and(eq(tenantUsers.tenantId, tenantId), eq(tenantUsers.role, 'owner')))
    .limit(1)
  if (!owner) return

  const token = await createAnamnesisToken(tenantId, patientId, owner.userId)
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.floraclin.com.br'
  const link = `${appUrl}/a/${token.token}`

  const normalizedPhone = toWhatsAppPhone(phone)
  const firstName = patient.fullName.split(' ')[0] || patient.fullName

  const params: Record<string, string> = {
    '1': firstName,
    '2': tenant.name,
  }

  const buttonParams = [{
    index: 0,
    subType: 'url',
    parameters: [{ type: 'text', text: token.token }],
  }]

  const result = await sendTemplateMessage(
    tenantId,
    normalizedPhone,
    template.name,
    template.language,
    params,
    buttonParams,
  )

  const conversation = await upsertConversation(
    tenantId,
    normalizedPhone,
    patient.fullName,
    undefined,
    patientId,
  )

  const message = await createMessage(tenantId, conversation.id, {
    direction: 'outbound',
    metaMessageId: result.metaMessageId,
    body: `Olá, ${firstName}! Para agilizar seu atendimento na ${tenant.name}, pedimos que preencha sua ficha de anamnese pelo link abaixo:\n\n${link}\n\nQualquer dúvida, estamos à disposição.`,
    templateName: template.name,
    deliveryStatus: 'sent',
  })

  await pushSseEvent(tenantId, 'new_message', {
    conversationId: conversation.id,
    message,
  })
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
  /** Quick reply tapped on a template message. */
  button?: { text?: string; payload?: string }
  /** Reply to another message. Carries the wamid of the message replied to. */
  context?: { id?: string; from?: string }
  /** Present only on the first inbound message of an ad-originated conversation. */
  referral?: {
    source_url?: string
    source_id?: string
    source_type?: string
    headline?: string
    body?: string
    media_type?: string
    image_url?: string
    video_url?: string
    thumbnail_url?: string
    ctwa_clid?: string
  }
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
