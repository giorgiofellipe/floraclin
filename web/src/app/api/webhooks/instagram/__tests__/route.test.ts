import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import crypto from 'crypto'
import { NextRequest } from 'next/server'

// ─── Mocks ──────────────────────────────────────────────────────────
//
// The webhook route reaches out to:
//   - @/lib/meta-webhook       (signature verification)
//   - @/db/client              (tenant lookup + media update)
//   - @/db/queries/instagram   (conversation/message/SSE helpers)
//   - @/db/queries/prospects   (createNewProspect)
//   - @/lib/instagram          (profile fetch + media download)
//   - @/lib/messaging/*        (shared prospect + classification helpers)
//
// All of those are mocked. The db.select(...).from(...).where(...).limit(1)
// chain used for tenant lookup is implemented as a chainable mock whose final
// `.limit()` call resolves to a configurable array. The db.update(...) chain
// used by updateMessageMedia (post-download fire-and-forget) is similarly
// stubbed but the route's main code paths do not await it.

const APP_SECRET = 'test-app-secret'
const VERIFY_TOKEN = 'test-verify-token'

process.env.META_APP_SECRET = APP_SECRET
process.env.INSTAGRAM_VERIFY_TOKEN = VERIFY_TOKEN

const verifyWebhookSignatureMock = vi.fn()
vi.mock('@/lib/meta-webhook', () => ({
  verifyWebhookSignature: (...a: unknown[]) => verifyWebhookSignatureMock(...a),
}))

// db.select tenant lookup — chainable mock. Last .limit(1) resolves to the
// `tenantResult` array configured by the individual test.
let tenantResult: Array<{ id: string }> = []
const dbSelectLimit = vi.fn(async () => tenantResult)
const dbSelectWhere = vi.fn(() => ({ limit: dbSelectLimit }))
const dbSelectFrom = vi.fn(() => ({ where: dbSelectWhere }))
const dbSelect = vi.fn(() => ({ from: dbSelectFrom }))

const dbUpdateWhere = vi.fn().mockResolvedValue(undefined)
const dbUpdateSet = vi.fn(() => ({ where: dbUpdateWhere }))
const dbUpdate = vi.fn((_table: unknown) => ({ set: dbUpdateSet }))

vi.mock('@/db/client', () => ({
  db: {
    select: () => dbSelect(),
    update: (table: unknown) => dbUpdate(table),
  },
}))

vi.mock('@/db/schema', () => ({
  tenants: { id: 'id', settings: 'settings' },
  instagramMessages: { metaMessageId: 'meta_message_id', mediaUrl: 'media_url' },
}))

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((a: unknown, b: unknown) => ({ _kind: 'eq', a, b })),
  and: vi.fn((...args: unknown[]) => ({ _kind: 'and', args })),
  sql: Object.assign(
    (strings: TemplateStringsArray, ...values: unknown[]) => ({
      _kind: 'sql',
      strings,
      values,
    }),
    { raw: (s: string) => ({ _kind: 'raw', s }) },
  ),
}))

const upsertConversationMock = vi.fn()
const createMessageMock = vi.fn()
const getMessageByMetaIdMock = vi.fn()
const getConversationByIgsidMock = vi.fn()
const getRecentInboundBodiesMock = vi.fn()
const incrementUnreadCountMock = vi.fn()
const markOutboundDeliveredUpToWatermarkMock = vi.fn()
const pushSseEventMock = vi.fn()
const getProspectByIgsidMock = vi.fn()
vi.mock('@/db/queries/instagram', () => ({
  upsertConversation: (...a: unknown[]) => upsertConversationMock(...a),
  createMessage: (...a: unknown[]) => createMessageMock(...a),
  getMessageByMetaId: (...a: unknown[]) => getMessageByMetaIdMock(...a),
  getConversationByIgsid: (...a: unknown[]) => getConversationByIgsidMock(...a),
  getRecentInboundBodies: (...a: unknown[]) => getRecentInboundBodiesMock(...a),
  incrementUnreadCount: (...a: unknown[]) => incrementUnreadCountMock(...a),
  markOutboundDeliveredUpToWatermark: (...a: unknown[]) =>
    markOutboundDeliveredUpToWatermarkMock(...a),
  pushSseEvent: (...a: unknown[]) => pushSseEventMock(...a),
  getProspectByIgsid: (...a: unknown[]) => getProspectByIgsidMock(...a),
}))

const createNewProspectMock = vi.fn()
const logProspectActivityMock = vi.fn()
vi.mock('@/db/queries/prospects', () => ({
  createNewProspect: (...a: unknown[]) => createNewProspectMock(...a),
  logProspectActivity: (...a: unknown[]) => logProspectActivityMock(...a),
}))

const getUserProfileMock = vi.fn()
const downloadAndStoreMediaMock = vi.fn()
vi.mock('@/lib/instagram', () => ({
  getUserProfile: (...a: unknown[]) => getUserProfileMock(...a),
  downloadAndStoreMedia: (...a: unknown[]) => downloadAndStoreMediaMock(...a),
}))

const findOrCreateProspectMock = vi.fn()
vi.mock('@/lib/messaging/find-or-create-prospect', () => ({
  findOrCreateProspect: (...a: unknown[]) => findOrCreateProspectMock(...a),
}))

const classifyProspectFromInboundMock = vi.fn()
vi.mock('@/lib/messaging/classify-prospect-from-inbound', () => ({
  classifyProspectFromInbound: (...a: unknown[]) =>
    classifyProspectFromInboundMock(...a),
}))

// ─── Constants / fixtures ───────────────────────────────────────────

const TENANT_ID = 'tenant-1'
const IG_BUSINESS_ACCOUNT_ID = 'ig-biz-acct-123'
const SENDER_IGSID = '17841400000000001'
const META_MESSAGE_ID = 'mid_aaa'
const CONVERSATION_ID = 'conv-1'
const PROSPECT_ID = 'prospect-1'
const PROSPECT_CREATED_AT = new Date('2026-05-27T11:00:00Z')
const NOW_TS = new Date('2026-05-27T12:00:00Z').getTime()

type EventPayload = Record<string, unknown>

function signBody(body: string, secret = APP_SECRET) {
  const hmac = crypto.createHmac('sha256', secret).update(body).digest('hex')
  return `sha256=${hmac}`
}

function makePostRequest(
  payload: unknown,
  opts: { signature?: string; rawBody?: string } = {},
): NextRequest {
  const raw = opts.rawBody ?? JSON.stringify(payload)
  return new NextRequest('http://test.local/api/webhooks/instagram', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-hub-signature-256': opts.signature ?? signBody(raw),
    },
    body: raw,
  })
}

function makeGetRequest(params: Record<string, string>): NextRequest {
  const qs = new URLSearchParams(params).toString()
  return new NextRequest(`http://test.local/api/webhooks/instagram?${qs}`)
}

function makeEventEntry(messaging: EventPayload[]): unknown {
  return {
    object: 'instagram',
    entry: [
      {
        id: IG_BUSINESS_ACCOUNT_ID,
        time: NOW_TS,
        messaging,
      },
    ],
  }
}

async function importRoute() {
  const mod = await import('../route')
  return mod
}

// ─── Lifecycle ──────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
  verifyWebhookSignatureMock.mockReturnValue(true)
  tenantResult = [{ id: TENANT_ID }]
  upsertConversationMock.mockResolvedValue({ id: CONVERSATION_ID, isNew: false })
  createMessageMock.mockImplementation(async (input) => ({
    id: 'msg-new',
    ...input,
  }))
  getMessageByMetaIdMock.mockResolvedValue(null)
  getRecentInboundBodiesMock.mockResolvedValue([])
  incrementUnreadCountMock.mockResolvedValue(undefined)
  pushSseEventMock.mockResolvedValue(undefined)
  getUserProfileMock.mockResolvedValue({
    name: 'Jane Doe',
    username: 'jane',
    profile_pic: 'https://cdn/pic.jpg',
  })
  downloadAndStoreMediaMock.mockResolvedValue('https://supabase/stored.jpg')
  findOrCreateProspectMock.mockResolvedValue({
    prospect: {
      id: PROSPECT_ID,
      stage: 'novo',
      createdAt: PROSPECT_CREATED_AT,
    },
    created: false,
  })
  classifyProspectFromInboundMock.mockResolvedValue(undefined)
  getProspectByIgsidMock.mockResolvedValue(null)
  createNewProspectMock.mockResolvedValue({
    id: PROSPECT_ID,
    stage: 'novo',
    createdAt: PROSPECT_CREATED_AT,
  })
  getConversationByIgsidMock.mockResolvedValue({ id: CONVERSATION_ID })
  markOutboundDeliveredUpToWatermarkMock.mockResolvedValue(0)
})

afterEach(() => {
  vi.useRealTimers()
})

// ───────────────────────────────────────────────────────────────────
// GET — Meta verification challenge
// ───────────────────────────────────────────────────────────────────

describe('GET /api/webhooks/instagram', () => {
  it('returns 200 with the challenge string when mode=subscribe and token matches', async () => {
    const { GET } = await importRoute()
    const req = makeGetRequest({
      'hub.mode': 'subscribe',
      'hub.verify_token': VERIFY_TOKEN,
      'hub.challenge': 'challenge-xyz',
    })

    const res = await GET(req)
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('challenge-xyz')
  })

  it('returns 403 when the verify token does not match', async () => {
    const { GET } = await importRoute()
    const req = makeGetRequest({
      'hub.mode': 'subscribe',
      'hub.verify_token': 'wrong-token',
      'hub.challenge': 'challenge-xyz',
    })

    const res = await GET(req)
    expect(res.status).toBe(403)
  })
})

// ───────────────────────────────────────────────────────────────────
// POST — signature + tenant resolution
// ───────────────────────────────────────────────────────────────────

describe('POST signature & tenant resolution', () => {
  it('returns 401 when verifyWebhookSignature returns false', async () => {
    verifyWebhookSignatureMock.mockReturnValue(false)
    const { POST } = await importRoute()

    const res = await POST(
      makePostRequest(makeEventEntry([])) as never,
    )

    expect(res.status).toBe(401)
    expect(dbSelect).not.toHaveBeenCalled()
    expect(upsertConversationMock).not.toHaveBeenCalled()
  })

  it('returns 200 (warn only) when no tenant matches the IG business account ID', async () => {
    tenantResult = []
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { POST } = await importRoute()

    const payload = makeEventEntry([
      {
        sender: { id: SENDER_IGSID },
        recipient: { id: IG_BUSINESS_ACCOUNT_ID },
        timestamp: NOW_TS,
        message: { mid: META_MESSAGE_ID, text: 'hi' },
      },
    ])
    const res = await POST(makePostRequest(payload))

    expect(res.status).toBe(200)
    expect(warnSpy).toHaveBeenCalled()
    expect(upsertConversationMock).not.toHaveBeenCalled()
    expect(createMessageMock).not.toHaveBeenCalled()
    warnSpy.mockRestore()
  })
})

// ───────────────────────────────────────────────────────────────────
// POST — message events
// ───────────────────────────────────────────────────────────────────

describe('POST message events', () => {
  it('processes a text inbound: conversation upsert, message insert, unread++, prospect, classify, SSE', async () => {
    const { POST } = await importRoute()
    const payload = makeEventEntry([
      {
        sender: { id: SENDER_IGSID },
        recipient: { id: IG_BUSINESS_ACCOUNT_ID },
        timestamp: NOW_TS,
        message: { mid: META_MESSAGE_ID, text: 'Olá clinica!' },
      },
    ])

    const res = await POST(makePostRequest(payload))
    expect(res.status).toBe(200)

    expect(upsertConversationMock).toHaveBeenCalledTimes(1)
    expect(upsertConversationMock.mock.calls[0]?.[0]).toMatchObject({
      tenantId: TENANT_ID,
      igsid: SENDER_IGSID,
      prospectId: PROSPECT_ID,
    })

    expect(createMessageMock).toHaveBeenCalledTimes(1)
    expect(createMessageMock.mock.calls[0]?.[0]).toMatchObject({
      tenantId: TENANT_ID,
      conversationId: CONVERSATION_ID,
      direction: 'inbound',
      messageType: 'text',
      metaMessageId: META_MESSAGE_ID,
      body: 'Olá clinica!',
      deliveryStatus: 'delivered',
    })

    expect(incrementUnreadCountMock).toHaveBeenCalledWith(
      TENANT_ID,
      CONVERSATION_ID,
    )
    expect(findOrCreateProspectMock).toHaveBeenCalledTimes(1)

    expect(pushSseEventMock).toHaveBeenCalledWith(
      TENANT_ID,
      'new_message',
      expect.objectContaining({ conversationId: CONVERSATION_ID }),
    )

    // classification is fire-and-forget (void async IIFE). Wait for the
    // microtask queue to flush so we can assert it was invoked.
    await new Promise((r) => setImmediate(r))
    expect(classifyProspectFromInboundMock).toHaveBeenCalledTimes(1)
    expect(classifyProspectFromInboundMock.mock.calls[0]?.[0]).toMatchObject({
      tenantId: TENANT_ID,
      prospectId: PROSPECT_ID,
      prospectStage: 'novo',
      channel: 'instagram',
    })
  })

  it('logs a prospect_created activity when findOrCreateProspect returns created=true', async () => {
    findOrCreateProspectMock.mockResolvedValueOnce({
      prospect: {
        id: PROSPECT_ID,
        stage: 'novo',
        createdAt: PROSPECT_CREATED_AT,
      },
      created: true,
    })
    const { POST } = await importRoute()
    const payload = makeEventEntry([
      {
        sender: { id: SENDER_IGSID },
        recipient: { id: IG_BUSINESS_ACCOUNT_ID },
        timestamp: NOW_TS,
        message: { mid: META_MESSAGE_ID, text: 'first contact' },
      },
    ])

    const res = await POST(makePostRequest(payload))
    expect(res.status).toBe(200)

    expect(logProspectActivityMock).toHaveBeenCalledWith(
      TENANT_ID,
      PROSPECT_ID,
      'created',
      expect.objectContaining({ source: 'instagram', auto: true }),
    )
  })

  it('does NOT log prospect_created when findOrCreateProspect returns an existing prospect', async () => {
    findOrCreateProspectMock.mockResolvedValueOnce({
      prospect: {
        id: PROSPECT_ID,
        stage: 'novo',
        createdAt: PROSPECT_CREATED_AT,
      },
      created: false,
    })
    const { POST } = await importRoute()
    const payload = makeEventEntry([
      {
        sender: { id: SENDER_IGSID },
        recipient: { id: IG_BUSINESS_ACCOUNT_ID },
        timestamp: NOW_TS,
        message: { mid: META_MESSAGE_ID, text: 'hi again' },
      },
    ])

    await POST(makePostRequest(payload))
    expect(logProspectActivityMock).not.toHaveBeenCalled()
  })

  it('skips reaction with cross-tenant target row (defense-in-depth)', async () => {
    getMessageByMetaIdMock.mockResolvedValue({
      id: 'msg-target',
      conversationId: CONVERSATION_ID,
      tenantId: 'other-tenant',
    })
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { POST } = await importRoute()
    const payload = makeEventEntry([
      {
        sender: { id: SENDER_IGSID },
        recipient: { id: IG_BUSINESS_ACCOUNT_ID },
        timestamp: NOW_TS,
        reaction: { mid: 'mid_target', action: 'react', emoji: '❤️' },
      },
    ])

    const res = await POST(makePostRequest(payload))
    expect(res.status).toBe(200)
    expect(createMessageMock).not.toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  it('skips profile fetch when conversation already has igProfileName', async () => {
    getConversationByIgsidMock.mockResolvedValueOnce({
      id: CONVERSATION_ID,
      igProfileName: 'Cached Name',
      igHandle: 'cached',
      igProfilePictureUrl: 'https://cdn/cached.jpg',
    })
    const { POST } = await importRoute()
    const payload = makeEventEntry([
      {
        sender: { id: SENDER_IGSID },
        recipient: { id: IG_BUSINESS_ACCOUNT_ID },
        timestamp: NOW_TS,
        message: { mid: META_MESSAGE_ID, text: 'ola' },
      },
    ])

    await POST(makePostRequest(payload))
    expect(getUserProfileMock).not.toHaveBeenCalled()
  })

  it('rejects payloads exceeding the entry cap with a warn, no DB writes', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { POST } = await importRoute()
    const entries = Array.from({ length: 51 }, () => ({
      id: IG_BUSINESS_ACCOUNT_ID,
      time: NOW_TS,
      messaging: [],
    }))
    const payload = { object: 'instagram', entry: entries }

    const res = await POST(makePostRequest(payload))
    expect(res.status).toBe(200)
    expect(upsertConversationMock).not.toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  it('skips echo events with no DB writes or SSE push', async () => {
    const { POST } = await importRoute()
    const payload = makeEventEntry([
      {
        sender: { id: IG_BUSINESS_ACCOUNT_ID },
        recipient: { id: SENDER_IGSID },
        timestamp: NOW_TS,
        message: {
          mid: META_MESSAGE_ID,
          text: 'our reply',
          is_echo: true,
        },
      },
    ])

    const res = await POST(makePostRequest(payload))
    expect(res.status).toBe(200)

    expect(upsertConversationMock).not.toHaveBeenCalled()
    expect(createMessageMock).not.toHaveBeenCalled()
    expect(pushSseEventMock).not.toHaveBeenCalled()
  })

  it('image attachment: createMessage messageType=image, fires downloadAndStoreMedia', async () => {
    const { POST } = await importRoute()
    const cdnUrl = 'https://lookaside.cdn/img.jpg'
    const payload = makeEventEntry([
      {
        sender: { id: SENDER_IGSID },
        recipient: { id: IG_BUSINESS_ACCOUNT_ID },
        timestamp: NOW_TS,
        message: {
          mid: META_MESSAGE_ID,
          attachments: [{ type: 'image', payload: { url: cdnUrl } }],
        },
      },
    ])

    const res = await POST(makePostRequest(payload))
    expect(res.status).toBe(200)

    expect(createMessageMock).toHaveBeenCalledTimes(1)
    expect(createMessageMock.mock.calls[0]?.[0]).toMatchObject({
      messageType: 'image',
      mediaType: 'image',
      mediaFilename: `image_${META_MESSAGE_ID}`,
    })

    expect(downloadAndStoreMediaMock).toHaveBeenCalledTimes(1)
    expect(downloadAndStoreMediaMock).toHaveBeenCalledWith(
      TENANT_ID,
      cdnUrl,
      `image_${META_MESSAGE_ID}`,
    )
  })

  it('story reply: messageType=story_reply with storyMediaUrl and storyId set', async () => {
    const { POST } = await importRoute()
    const storyUrl = 'https://cdn/story.mp4'
    const storyId = 'story-555'
    const payload = makeEventEntry([
      {
        sender: { id: SENDER_IGSID },
        recipient: { id: IG_BUSINESS_ACCOUNT_ID },
        timestamp: NOW_TS,
        message: {
          mid: META_MESSAGE_ID,
          text: 'reply to story',
          reply_to: { story: { url: storyUrl, id: storyId } },
        },
      },
    ])

    const res = await POST(makePostRequest(payload))
    expect(res.status).toBe(200)

    expect(createMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        messageType: 'story_reply',
        storyMediaUrl: storyUrl,
        storyId,
      }),
    )
  })
})

// ───────────────────────────────────────────────────────────────────
// POST — reaction events
// ───────────────────────────────────────────────────────────────────

describe('POST reaction events', () => {
  it('react with known mid: inserts reaction row and pushes SSE', async () => {
    getMessageByMetaIdMock.mockResolvedValue({
      id: 'msg-target',
      conversationId: CONVERSATION_ID,
      tenantId: TENANT_ID,
    })
    const { POST } = await importRoute()
    const payload = makeEventEntry([
      {
        sender: { id: SENDER_IGSID },
        recipient: { id: IG_BUSINESS_ACCOUNT_ID },
        timestamp: NOW_TS,
        reaction: {
          mid: 'mid_target',
          action: 'react',
          emoji: '❤️',
        },
      },
    ])

    const res = await POST(makePostRequest(payload))
    expect(res.status).toBe(200)

    expect(createMessageMock).toHaveBeenCalledTimes(1)
    expect(createMessageMock.mock.calls[0]?.[0]).toMatchObject({
      tenantId: TENANT_ID,
      conversationId: CONVERSATION_ID,
      direction: 'inbound',
      messageType: 'reaction',
      metaMessageId: null,
      reactionEmoji: '❤️',
      reactsToMessageId: 'msg-target',
      deliveryStatus: 'delivered',
    })

    expect(pushSseEventMock).toHaveBeenCalledWith(
      TENANT_ID,
      'new_message',
      expect.objectContaining({ conversationId: CONVERSATION_ID }),
    )
  })

  it('unreact: logged, no DB writes, no throw', async () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})
    const { POST } = await importRoute()
    const payload = makeEventEntry([
      {
        sender: { id: SENDER_IGSID },
        recipient: { id: IG_BUSINESS_ACCOUNT_ID },
        timestamp: NOW_TS,
        reaction: { mid: 'mid_target', action: 'unreact' },
      },
    ])

    const res = await POST(makePostRequest(payload))
    expect(res.status).toBe(200)

    expect(createMessageMock).not.toHaveBeenCalled()
    expect(pushSseEventMock).not.toHaveBeenCalled()
    expect(infoSpy).toHaveBeenCalled()
    infoSpy.mockRestore()
  })

  it('react with unknown mid: no DB writes, no throw', async () => {
    getMessageByMetaIdMock.mockResolvedValue(null)
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { POST } = await importRoute()
    const payload = makeEventEntry([
      {
        sender: { id: SENDER_IGSID },
        recipient: { id: IG_BUSINESS_ACCOUNT_ID },
        timestamp: NOW_TS,
        reaction: { mid: 'unknown-mid', action: 'react', emoji: '👍' },
      },
    ])

    const res = await POST(makePostRequest(payload))
    expect(res.status).toBe(200)
    expect(createMessageMock).not.toHaveBeenCalled()
    expect(pushSseEventMock).not.toHaveBeenCalled()
    warnSpy.mockRestore()
  })
})

// ───────────────────────────────────────────────────────────────────
// POST — read / delivery events
// ───────────────────────────────────────────────────────────────────

describe('POST read/delivery events', () => {
  it("read event: calls markOutboundDeliveredUpToWatermark with status='read' and watermark Date, pushes status_update", async () => {
    const watermarkMs = NOW_TS - 5_000
    const { POST } = await importRoute()
    const payload = makeEventEntry([
      {
        sender: { id: SENDER_IGSID },
        recipient: { id: IG_BUSINESS_ACCOUNT_ID },
        timestamp: NOW_TS,
        read: { watermark: watermarkMs },
      },
    ])

    const res = await POST(makePostRequest(payload))
    expect(res.status).toBe(200)

    expect(markOutboundDeliveredUpToWatermarkMock).toHaveBeenCalledTimes(1)
    const args = markOutboundDeliveredUpToWatermarkMock.mock.calls[0]
    expect(args?.[0]).toBe(TENANT_ID)
    expect(args?.[1]).toBe(CONVERSATION_ID)
    expect(args?.[2]).toBeInstanceOf(Date)
    expect((args?.[2] as Date).getTime()).toBe(watermarkMs)
    expect(args?.[3]).toBe('read')

    expect(pushSseEventMock).toHaveBeenCalledWith(
      TENANT_ID,
      'status_update',
      expect.objectContaining({
        conversationId: CONVERSATION_ID,
        status: 'read',
        watermark: watermarkMs,
      }),
    )
  })

  it("delivery event: calls markOutboundDeliveredUpToWatermark with status='delivered'", async () => {
    const watermarkMs = NOW_TS - 1_000
    const { POST } = await importRoute()
    const payload = makeEventEntry([
      {
        sender: { id: SENDER_IGSID },
        recipient: { id: IG_BUSINESS_ACCOUNT_ID },
        timestamp: NOW_TS,
        delivery: { watermark: watermarkMs, mids: ['mid_a', 'mid_b'] },
      },
    ])

    const res = await POST(makePostRequest(payload))
    expect(res.status).toBe(200)

    expect(markOutboundDeliveredUpToWatermarkMock).toHaveBeenCalledTimes(1)
    const args = markOutboundDeliveredUpToWatermarkMock.mock.calls[0]
    expect(args?.[3]).toBe('delivered')
  })
})

// ───────────────────────────────────────────────────────────────────
// POST — unknown / malformed events
// ───────────────────────────────────────────────────────────────────

describe('POST unknown and malformed events', () => {
  it('unknown event type (postback): logged, no DB writes, returns 200', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { POST } = await importRoute()
    const payload = makeEventEntry([
      {
        sender: { id: SENDER_IGSID },
        recipient: { id: IG_BUSINESS_ACCOUNT_ID },
        timestamp: NOW_TS,
        postback: { title: 'tap', payload: 'GET_STARTED' },
      },
    ])

    const res = await POST(makePostRequest(payload))
    expect(res.status).toBe(200)
    expect(createMessageMock).not.toHaveBeenCalled()
    expect(upsertConversationMock).not.toHaveBeenCalled()
    expect(pushSseEventMock).not.toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  it('event missing sender or recipient: skipped silently', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { POST } = await importRoute()
    const payload = makeEventEntry([
      // Missing sender
      {
        recipient: { id: IG_BUSINESS_ACCOUNT_ID },
        timestamp: NOW_TS,
        message: { mid: META_MESSAGE_ID, text: 'hi' },
      },
      // Missing recipient
      {
        sender: { id: SENDER_IGSID },
        timestamp: NOW_TS,
        message: { mid: 'mid_other', text: 'hi2' },
      },
    ])

    const res = await POST(makePostRequest(payload))
    expect(res.status).toBe(200)
    expect(createMessageMock).not.toHaveBeenCalled()
    expect(upsertConversationMock).not.toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  it('returns 500 when a recoverable internal DB error occurs (so Meta retries)', async () => {
    upsertConversationMock.mockRejectedValueOnce(new Error('boom'))
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { POST } = await importRoute()
    const payload = makeEventEntry([
      {
        sender: { id: SENDER_IGSID },
        recipient: { id: IG_BUSINESS_ACCOUNT_ID },
        timestamp: NOW_TS,
        message: { mid: META_MESSAGE_ID, text: 'hi' },
      },
    ])

    const res = await POST(makePostRequest(payload))
    expect(res.status).toBe(500)
    expect(errSpy).toHaveBeenCalled()
    errSpy.mockRestore()
  })
})
