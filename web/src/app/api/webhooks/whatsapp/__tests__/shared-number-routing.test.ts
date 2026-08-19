/**
 * Shared-number tenant resolution, with the REAL normalizeBrPhone.
 *
 * This is the path that broke in production and the reason nothing was
 * recorded. The cron stored the conversation under one string, the webhook
 * looked up another, `resolveSharedNumberTenant` returned null, and the
 * message was dropped before anything was written. Delivery and read
 * callbacks went the same way.
 *
 * The sibling suite (`confirmation-reply.test.ts`) mocks normalizeBrPhone as
 * the identity function and exercises the dedicated-number branch, so it
 * cannot catch this. Here the real helper runs and the assertion is on the
 * exact string handed to the conversation lookup.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { createHmac } from 'crypto'

const TEST_APP_SECRET = 'test-app-secret'
const SHARED_PHONE_NUMBER_ID = 'shared-pni-123'
const TENANT_ID = 'tenant-shared-1'

/** What Meta puts in `from`: no 9th digit, country code present. */
const META_FROM = '554788443635'
/** What the clinic typed, and therefore what the cron normalized and stored. */
const PATIENT_RECORD_PHONE = '(47) 98844-3635'
/** The one canonical form both must produce. */
const CANONICAL = '5547988443635'

const limitMock = vi.fn()
const whereMock = vi.fn()

vi.mock('@/db/client', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: whereMock,
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({ where: vi.fn(() => ({ returning: vi.fn(() => []) })) })),
    })),
  },
}))

vi.mock('@/db/schema', () => ({
  tenants: { id: 'id', settings: 'settings' },
  procedureTypes: { id: 'id', name: 'name', tenantId: 'tenant_id', defaultPrice: 'default_price' },
  whatsappMessages: { tenantId: 'tenant_id', metaMessageId: 'meta_message_id', mediaUrl: 'media_url' },
  whatsappConversations: {
    tenantId: 'tenant_id',
    phoneNumber: 'phone_number',
    lastMessageAt: 'last_message_at',
  },
}))

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((column: unknown, value: unknown) => ({ column, value })),
  and: vi.fn((...args: unknown[]) => args),
  desc: vi.fn((c: unknown) => c),
  sql: vi.fn(),
}))

// Everything from @/lib/whatsapp is stubbed EXCEPT normalizeBrPhone, which is
// the function under test here.
vi.mock('@/lib/whatsapp', async () => {
  const { normalizeBrPhone } = await vi.importActual<typeof import('@/lib/phone')>('@/lib/phone')
  return {
    normalizeBrPhone,
    verifyWebhookSignature: vi.fn(() => true),
    downloadAndStoreMedia: vi.fn(),
    sendTextMessage: vi.fn(),
    sendTemplateMessage: vi.fn(),
    sendMediaMessage: vi.fn(),
    getTemplateForTenant: vi.fn(),
    CreditExhaustedError: class extends Error {},
  }
})

vi.mock('@/db/queries/whatsapp', () => ({
  upsertConversation: vi.fn(async () => ({ id: 'conv-1' })),
  createMessage: vi.fn(async () => ({ id: 'msg-1', conversationId: 'conv-1' })),
  incrementUnreadCount: vi.fn(),
  updateMessageStatus: vi.fn(),
  pushSseEvent: vi.fn(),
  getMessageByMetaId: vi.fn(async () => null),
  getRecentInboundBodies: vi.fn(async () => []),
  getQueuedMessages: vi.fn(async () => []),
  updateQueuedMessageStatus: vi.fn(),
  expireStaleQueuedMessages: vi.fn(),
  listAutomations: vi.fn(async () => []),
}))

vi.mock('@/db/queries/appointments', () => ({
  getAppointmentByConfirmationMessageId: vi.fn(async () => null),
  confirmAppointment: vi.fn(),
  requestReschedule: vi.fn(),
}))
vi.mock('@/db/queries/anamnesis', () => ({ getAnamnesis: vi.fn(async () => null) }))
vi.mock('@/db/queries/anamnesis-tokens', () => ({ createAnamnesisToken: vi.fn() }))
vi.mock('@/db/queries/prospects', () => ({
  createNewProspect: vi.fn(async () => ({ id: 'p-1', stage: 'qualificado', createdAt: new Date().toISOString() })),
  getProspectByPhone: vi.fn(async () => ({ id: 'p-1', stage: 'qualificado', createdAt: new Date().toISOString() })),
  updateProspect: vi.fn(),
  logProspectActivity: vi.fn(),
}))
vi.mock('@/db/queries/patients', () => ({ getPatientByPhone: vi.fn(async () => null) }))

import { POST } from '../route'
import { createMessage } from '@/db/queries/whatsapp'
import { normalizeBrPhone } from '@/lib/whatsapp'
import { eq } from 'drizzle-orm'

function sign(raw: string) {
  return `sha256=${createHmac('sha256', TEST_APP_SECRET).update(raw).digest('hex')}`
}

function inboundPayload() {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'entry-1',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: { phone_number_id: SHARED_PHONE_NUMBER_ID },
              contacts: [{ wa_id: META_FROM, profile: { name: 'Giorgio' } }],
              messages: [
                {
                  id: 'wamid.inbound-1',
                  from: META_FROM,
                  timestamp: '1755000000',
                  type: 'text',
                  text: { body: 'oi' },
                },
              ],
            },
          },
        ],
      },
    ],
  }
}

function makeRequest(body: unknown) {
  const raw = JSON.stringify(body)
  return new NextRequest('http://localhost/api/webhooks/whatsapp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-hub-signature-256': sign(raw) },
    body: raw,
  })
}

/** Conversation lookup returns a tenant; the chain is select→from→where→orderBy→limit. */
function conversationFound(found: boolean) {
  limitMock.mockResolvedValue(found ? [{ tenantId: TENANT_ID }] : [])
  whereMock.mockReturnValue({ orderBy: vi.fn(() => ({ limit: limitMock })) })
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.META_APP_SECRET = TEST_APP_SECRET
  process.env.FLORACLIN_WA_PHONE_NUMBER_ID = SHARED_PHONE_NUMBER_ID
  conversationFound(true)
})

describe('shared-number routing', () => {
  it('looks the conversation up by the same string the cron stored', async () => {
    // The two sources of the same person must already agree before the
    // webhook runs. This is the invariant the production bug violated.
    expect(normalizeBrPhone(PATIENT_RECORD_PHONE)).toBe(CANONICAL)
    expect(normalizeBrPhone(META_FROM)).toBe(CANONICAL)

    const res = await POST(makeRequest(inboundPayload()))
    expect(res.status).toBe(200)

    // The lookup key handed to the conversation query, not a value we made up.
    // `eq` is mocked to echo its arguments, and the schema mock makes the
    // column a plain string, so the calls can be read directly.
    const comparedPhones = (vi.mocked(eq).mock.calls as unknown as [string, string][])
      .filter(([column]) => column === 'phone_number')
      .map(([, value]) => value)

    expect(comparedPhones.length).toBeGreaterThan(0)
    expect(comparedPhones).toContain(CANONICAL)
    // The pre-fix value. If this ever comes back, replies stop being routed.
    expect(comparedPhones).not.toContain('47988443635')
  })

  it('stores the inbound message once the tenant resolves', async () => {
    const res = await POST(makeRequest(inboundPayload()))
    expect(res.status).toBe(200)
    expect(createMessage).toHaveBeenCalledWith(
      TENANT_ID,
      'conv-1',
      expect.objectContaining({ direction: 'inbound', body: 'oi' }),
    )
  })

  it('drops nothing silently when no conversation matches', async () => {
    // The failure mode that hid the bug: null tenant, console.warn, no write,
    // and a 200 back to Meta so it never retries.
    conversationFound(false)
    const res = await POST(makeRequest(inboundPayload()))
    expect(res.status).toBe(200)
    expect(createMessage).not.toHaveBeenCalled()
  })
})
