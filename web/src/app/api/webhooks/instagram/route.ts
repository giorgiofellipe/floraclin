import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/db/client'
import { tenants, instagramMessages } from '@/db/schema'
import { eq, and, sql } from 'drizzle-orm'
import { verifyWebhookSignature } from '@/lib/meta-webhook'
import {
  downloadAndStoreMedia,
  getUserProfile,
} from '@/lib/instagram'
import {
  upsertConversation,
  createMessage,
  getMessageByMetaId,
  getConversationByIgsid,
  getRecentInboundBodies,
  incrementUnreadCount,
  markOutboundDeliveredUpToWatermark,
  pushSseEvent,
  getProspectByIgsid,
} from '@/db/queries/instagram'
import { createNewProspect, logProspectActivity } from '@/db/queries/prospects'
import { findOrCreateProspect } from '@/lib/messaging/find-or-create-prospect'
import { classifyProspectFromInbound } from '@/lib/messaging/classify-prospect-from-inbound'

export const dynamic = 'force-dynamic'

// Defense-in-depth: cap entry/event counts in case META_APP_SECRET leaks and
// a malicious actor crafts payloads to amplify load.
const MAX_ENTRIES_PER_PAYLOAD = 50
const MAX_EVENTS_PER_ENTRY = 100

// ---------------------------------------------------------------------------
// GET -- Meta verification challenge
// ---------------------------------------------------------------------------
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const mode = searchParams.get('hub.mode')
  const token = searchParams.get('hub.verify_token')
  const challenge = searchParams.get('hub.challenge')

  if (mode === 'subscribe' && token === process.env.INSTAGRAM_VERIFY_TOKEN) {
    return new Response(challenge, { status: 200 })
  }

  return NextResponse.json({ error: 'Verification failed' }, { status: 403 })
}

// ---------------------------------------------------------------------------
// POST -- Receive messages, reactions, read/delivery receipts
// ---------------------------------------------------------------------------
export async function POST(request: NextRequest) {
  const rawBody = await request.text()
  const signature = request.headers.get('x-hub-signature-256') ?? ''
  const appSecret = process.env.META_APP_SECRET

  if (!appSecret || !verifyWebhookSignature(rawBody, signature, appSecret)) {
    const ip = request.headers.get('x-forwarded-for') ?? 'unknown'
    // Avoid leaking the full signature; the first ~16 chars are enough to
    // correlate with logs while preventing reuse.
    const sigPrefix = signature ? signature.slice(0, 16) : 'absent'
    console.warn(
      `Instagram webhook: invalid signature (prefix=${sigPrefix} ip=${ip})`,
    )
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  let body: IgWebhookPayload
  try {
    body = JSON.parse(rawBody) as IgWebhookPayload
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const entries = body.entry ?? []
  if (entries.length > MAX_ENTRIES_PER_PAYLOAD) {
    console.warn(
      `Instagram webhook: payload exceeds entry cap (${entries.length} > ${MAX_ENTRIES_PER_PAYLOAD}); ignoring`,
    )
    return NextResponse.json({ success: true }, { status: 200 })
  }

  // If any per-event DB write fails (recoverable), surface a 500 so Meta
  // retries. Dedup via metaMessageId makes retry safe.
  let recoverable_failure = false

  for (const entry of entries) {
    const igBusinessAccountId = entry.id
    if (!igBusinessAccountId) continue

    // Look up tenant by IG Business Account ID stored in settings JSONB
    const [tenant] = await db
      .select()
      .from(tenants)
      .where(
        sql`${tenants.settings}->>'instagram_business_account_id' = ${igBusinessAccountId}`,
      )
      .limit(1)

    if (!tenant) {
      console.warn(
        `Instagram webhook: unknown instagram_business_account_id ${igBusinessAccountId}`,
      )
      continue
    }

    const tenantId = tenant.id

    const events = entry.messaging ?? []
    if (events.length > MAX_EVENTS_PER_ENTRY) {
      console.warn(
        `Instagram webhook: entry exceeds event cap (${events.length} > ${MAX_EVENTS_PER_ENTRY}); skipping entry`,
      )
      continue
    }

    for (const event of events) {
      // Defensive: skip events lacking sender or recipient
      if (!event.sender?.id || !event.recipient?.id) {
        console.warn(
          'Instagram webhook: skipping event missing sender or recipient',
        )
        continue
      }

      try {
        if (event.message) {
          await processMessageEvent(tenantId, event)
        } else if (event.reaction) {
          await processReactionEvent(tenantId, event)
        } else if (event.read) {
          await processReadOrDeliveryEvent(tenantId, event, 'read')
        } else if (event.delivery) {
          await processReadOrDeliveryEvent(tenantId, event, 'delivered')
        } else {
          console.warn(
            'Instagram webhook: unknown event keys',
            Object.keys(event),
          )
        }
      } catch (err) {
        console.error('Error processing Instagram event:', err)
        // Treat any thrown error as recoverable so Meta retries. Validation
        // / parse errors happen at the top of the handler and never reach
        // here, so anything raised inside per-event processing is a real
        // failure worth retrying.
        recoverable_failure = true
      }
    }
  }

  if (recoverable_failure) {
    return NextResponse.json(
      { error: 'recoverable_failure' },
      { status: 500 },
    )
  }
  return NextResponse.json({ success: true }, { status: 200 })
}

// ---------------------------------------------------------------------------
// Message event processing
// ---------------------------------------------------------------------------
async function processMessageEvent(tenantId: string, event: IgMessagingEvent) {
  const message = event.message
  if (!message) return

  // Echo detection: skip our own outbound messages echoed back to us.
  // We already record outbound messages when sending; do NOT compare sender.id.
  if (message.is_echo === true) return

  const metaMessageId = message.mid
  if (!metaMessageId) return

  // Dedupe by meta message ID — Meta retries on non-2xx
  const existingMsg = await getMessageByMetaId(tenantId, metaMessageId)
  if (existingMsg) return

  const senderIgsid = event.sender!.id
  const timestamp = event.timestamp ? new Date(event.timestamp) : new Date()

  // Determine message type and extract content
  let messageType: 'text' | 'story_reply' | 'image' | 'video' | 'audio' | 'file' =
    'text'
  const bodyText: string | null = message.text ?? null
  let mediaType: string | null = null
  const mediaUrl: string | null = null
  let mediaFilename: string | null = null
  let storyMediaUrl: string | null = null
  let storyId: string | null = null

  if (message.reply_to?.story) {
    messageType = 'story_reply'
    storyMediaUrl = message.reply_to.story.url ?? null
    storyId = message.reply_to.story.id ?? null
    // Story media URLs are IG CDN URLs that expire in ~24h. Rehost.
    if (storyMediaUrl) {
      const storyFilename = `story-media_${metaMessageId}`
      const cdnUrl = storyMediaUrl
      downloadAndStoreMedia(tenantId, cdnUrl, storyFilename)
        .then(async (storedUrl) => {
          await updateMessageStoryMedia(metaMessageId, storedUrl)
        })
        .catch((err: unknown) =>
          console.error('IG story media download failed:', err),
        )
    }
  } else if (message.attachments && message.attachments.length > 0) {
    const attachment = message.attachments[0]
    const type = attachment.type
    if (
      type === 'image' ||
      type === 'video' ||
      type === 'audio' ||
      type === 'file'
    ) {
      messageType = type
      mediaType = type
      const cdnUrl = attachment.payload?.url ?? null
      mediaFilename = `${type}_${metaMessageId}`
      if (cdnUrl) {
        // Fire-and-forget: download to Supabase. Never store IG CDN URL directly
        // (it expires in ~24h). We pass null to mediaUrl on the initial insert
        // and rely on a follow-up update once download completes.
        downloadAndStoreMedia(tenantId, cdnUrl, mediaFilename)
          .then(async (storedUrl) => {
            await updateMessageMedia(metaMessageId, storedUrl)
          })
          .catch((err: unknown) =>
            console.error('IG media download failed:', err),
          )
      }
    }
  }

  // Profile enrichment — only call the Graph API if we don't already have
  // enriched fields. Reduces token usage and rate-limit risk.
  const existingConversation = await getConversationByIgsid(tenantId, senderIgsid)
  let profile: { name?: string; username?: string; profile_pic?: string } = {}
  if (
    !existingConversation ||
    (!existingConversation.igProfileName && !existingConversation.igHandle)
  ) {
    profile = await getUserProfile(tenantId, senderIgsid).catch((err) => {
      console.error('IG profile fetch failed:', err)
      return {}
    })
  }
  const profileName: string | null =
    profile.name ?? existingConversation?.igProfileName ?? null
  const profileHandle: string | null =
    profile.username ?? existingConversation?.igHandle ?? null
  const profilePictureUrl: string | null =
    profile.profile_pic ?? existingConversation?.igProfilePictureUrl ?? null

  // Find or create prospect (channel-agnostic helper)
  type ProspectShape = { id: string; stage: string; createdAt: Date }
  const { prospect, created: isNewProspect } =
    await findOrCreateProspect<ProspectShape>({
      lookup: () => getProspectByIgsid(tenantId, senderIgsid),
      createNew: async () => {
        const p = await createNewProspect(tenantId, {
          source: 'instagram',
          igsid: senderIgsid,
          igHandle: profileHandle,
          name: profileName,
        })
        return { id: p.id, stage: p.stage, createdAt: p.createdAt }
      },
    })

  if (isNewProspect) {
    await logProspectActivity(tenantId, prospect.id, 'created', {
      source: 'instagram',
      auto: true,
    })
  }

  // Upsert conversation. Pass profile fields so the row is enriched on first
  // creation OR updated on subsequent inbounds if the profile changed.
  const conversation = await upsertConversation({
    tenantId,
    igsid: senderIgsid,
    igHandle: profileHandle,
    igProfileName: profileName,
    igProfilePictureUrl: profilePictureUrl,
    lastInboundAt: timestamp,
    prospectId: prospect.id,
  })

  // Insert the message row
  const insertedMessage = await createMessage({
    tenantId,
    conversationId: conversation.id,
    direction: 'inbound',
    messageType,
    metaMessageId,
    body: bodyText,
    mediaType,
    mediaUrl,
    mediaFilename,
    storyMediaUrl,
    storyId,
    deliveryStatus: 'delivered',
    timestamp,
  })

  // Increment unread counter (also bumps lastMessageAt). lastInboundAt is
  // already authoritative from upsertConversation above.
  await incrementUnreadCount(tenantId, conversation.id)

  // Push SSE: always new_message, and new_conversation if just created
  await pushSseEvent(tenantId, 'new_message', {
    conversationId: conversation.id,
    message: insertedMessage,
  })

  if (conversation.isNew) {
    await pushSseEvent(tenantId, 'new_conversation', {
      conversation: { id: conversation.id },
      prospect,
    })
  }

  // Fire-and-forget classification while the lead is still 'novo'.
  // Boundary: prospect.createdAt - 60s (account for clock drift between IG
  // and DB NOW()). Use explicit `new Date(... .getTime() - 60_000)` form.
  if (prospect.stage === 'novo') {
    const boundary = new Date(prospect.createdAt.getTime() - 60_000)
    void (async () => {
      try {
        const recentInboundBodies = await getRecentInboundBodies(
          tenantId,
          conversation.id,
          5,
          boundary,
        )
        await classifyProspectFromInbound({
          tenantId,
          prospectId: prospect.id,
          prospectStage: prospect.stage,
          recentInboundBodies,
          channel: 'instagram',
        })
      } catch (err) {
        console.error('IG classify failed', err)
      }
    })()
  }
}

// ---------------------------------------------------------------------------
// Reaction event processing
// ---------------------------------------------------------------------------
async function processReactionEvent(tenantId: string, event: IgMessagingEvent) {
  const reaction = event.reaction
  if (!reaction) return

  const action = reaction.action
  const targetMid = reaction.mid

  if (!targetMid) {
    console.warn('Instagram webhook: reaction missing mid')
    return
  }

  // v1: only handle `react`. `unreact` requires per-sender attribution that
  // we don't store yet (would need a senderIgsid column on reaction rows).
  if (action === 'unreact') {
    console.info(
      'Instagram webhook: skipping unreact in v1 (no per-sender attribution)',
    )
    return
  }

  if (action !== 'react') {
    console.warn('Instagram webhook: unknown reaction action', action)
    return
  }

  // Resolve the reacted-to message
  const target = await getMessageByMetaId(tenantId, targetMid)
  if (!target) {
    console.warn(
      `Instagram webhook: reaction references unknown mid ${targetMid}`,
    )
    return
  }

  // Defense-in-depth: confirm the target row belongs to the webhook's tenant
  // even though getMessageByMetaId already filters by tenantId.
  if (target.tenantId !== tenantId) {
    console.warn(
      `Instagram webhook: reaction tenant mismatch (target=${target.tenantId} webhook=${tenantId}); skipping`,
    )
    return
  }

  const inserted = await createMessage({
    tenantId,
    conversationId: target.conversationId,
    direction: 'inbound',
    messageType: 'reaction',
    metaMessageId: null,
    body: null,
    reactionEmoji: reaction.emoji ?? null,
    reactsToMessageId: target.id,
    deliveryStatus: 'delivered',
    timestamp: event.timestamp ? new Date(event.timestamp) : new Date(),
  })

  await pushSseEvent(tenantId, 'new_message', {
    conversationId: target.conversationId,
    message: inserted,
  })
}

// ---------------------------------------------------------------------------
// Read / Delivery event processing (watermark-based)
// ---------------------------------------------------------------------------
async function processReadOrDeliveryEvent(
  tenantId: string,
  event: IgMessagingEvent,
  status: 'read' | 'delivered',
) {
  const wm = status === 'read' ? event.read?.watermark : event.delivery?.watermark
  if (!wm) return

  // Resolve conversation by sender IGSID. The sender on read/delivery events
  // is the IG user who acked the message (not our page), so we look up the
  // conversation they own.
  const senderIgsid = event.sender!.id
  const conversation = await getConversationByIgsid(tenantId, senderIgsid)
  if (!conversation) {
    // We may not have a conversation row if we never received an inbound
    // (rare race). Skip — nothing to update.
    return
  }

  await markOutboundDeliveredUpToWatermark(
    tenantId,
    conversation.id,
    new Date(wm),
    status,
  )

  await pushSseEvent(tenantId, 'status_update', {
    conversationId: conversation.id,
    status,
    watermark: wm,
  })
}

// ---------------------------------------------------------------------------
// Media URL update after async download completes
// ---------------------------------------------------------------------------
async function updateMessageMedia(metaMessageId: string, storedUrl: string) {
  // Direct DB update — B2's queries module does not expose a generic
  // field-update helper for messages; we use a raw drizzle update here.
  await db
    .update(instagramMessages)
    .set({ mediaUrl: storedUrl })
    .where(eq(instagramMessages.metaMessageId, metaMessageId))
}

async function updateMessageStoryMedia(
  metaMessageId: string,
  storedUrl: string,
) {
  await db
    .update(instagramMessages)
    .set({ storyMediaUrl: storedUrl })
    .where(
      and(
        eq(instagramMessages.metaMessageId, metaMessageId),
        eq(instagramMessages.messageType, 'story_reply'),
      ),
    )
}

// ---------------------------------------------------------------------------
// Type definitions for Meta Instagram webhook payload
// ---------------------------------------------------------------------------
interface IgWebhookPayload {
  object?: string
  entry?: IgEntry[]
}

interface IgEntry {
  id: string
  time?: number
  messaging?: IgMessagingEvent[]
}

interface IgMessagingEvent {
  sender?: { id: string }
  recipient?: { id: string }
  timestamp?: number
  message?: IgMessage
  reaction?: IgReaction
  read?: { mid?: string; watermark?: number }
  delivery?: { mids?: string[]; watermark?: number }
  postback?: unknown
  optin?: unknown
  referral?: unknown
}

interface IgMessage {
  mid: string
  text?: string
  is_echo?: boolean
  attachments?: IgAttachment[]
  reply_to?: {
    mid?: string
    story?: { url?: string; id?: string }
  }
}

interface IgAttachment {
  type: string
  payload?: { url?: string; sticker_id?: string | number }
}

interface IgReaction {
  mid: string
  action: 'react' | 'unreact' | string
  emoji?: string
  reaction?: string
}
