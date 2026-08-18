/**
 * Tests for shared-number tenant resolution in the WhatsApp webhook.
 *
 * Multiple tenants share the FloraClin WhatsApp number. resolveSharedNumberTenant
 * (not exported) decides which tenant an inbound message or status update
 * belongs to. It is not exported from route.ts, so we exercise it through the
 * POST handler with metadata.phone_number_id set to FLORACLIN_WA_PHONE_NUMBER_ID,
 * which routes the payload through the shared-number branch. All DB queries and
 * external calls are mocked so these are pure-unit tests (no DB, no HTTP, no
 * Next runtime).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import crypto from 'crypto'

// ---------------------------------------------------------------------------
// Mocks — hoisted by vitest, declared before any imports from the module
// ---------------------------------------------------------------------------

/**
 * Builds a chainable object that mimics drizzle's query builder for both
 * shapes used by the resolver:
 *   - db.select(...).from(...).where(...).limit(1)      (message-id lookup)
 *   - db.selectDistinct(...).from(...).where(...)        (phone-history lookup, awaited directly)
 */
function makeSelectChain(result: unknown[]) {
  const promise = Object.assign(Promise.resolve(result), {
    limit: vi.fn().mockResolvedValue(result),
  })
  return {
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue(promise),
    }),
  }
}

const captureExceptionMock = vi.fn()

vi.mock('@sentry/nextjs', () => ({
  captureException: (...args: unknown[]) => captureExceptionMock(...args),
}))

vi.mock('@/db/client', () => ({
  db: {
    select: vi.fn(),
    selectDistinct: vi.fn(),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => ({
          returning: vi.fn(() => []),
        })),
      })),
    })),
  },
}))

vi.mock('@/db/schema', () => ({
  tenants: { id: 'id', settings: 'settings' },
  tenantUsers: { tenantId: 'tenant_id', userId: 'user_id', role: 'role' },
  procedureTypes: { id: 'id', name: 'name', tenantId: 'tenant_id', defaultPrice: 'default_price' },
  whatsappMessages: { tenantId: 'tenant_id', metaMessageId: 'meta_message_id', mediaUrl: 'media_url' },
  whatsappConversations: { tenantId: 'tenant_id', phoneNumber: 'phone_number', lastMessageAt: 'last_message_at' },
}))

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((...args: unknown[]) => args),
  and: vi.fn((...args: unknown[]) => args),
  sql: vi.fn(),
}))

vi.mock('@/lib/whatsapp', () => ({
  verifyWebhookSignature: vi.fn(),
  downloadAndStoreMedia: vi.fn(),
  sendTextMessage: vi.fn(),
  sendTemplateMessage: vi.fn(),
  sendMediaMessage: vi.fn(),
  normalizeBrPhone: vi.fn((phone: string) => phone),
  getTemplateForTenant: vi.fn(),
  CreditExhaustedError: class CreditExhaustedError extends Error {
    constructor(public creditsUsed: number, public creditsTotal: number) {
      super(`Credits exhausted`)
      this.name = 'CreditExhaustedError'
    }
  },
}))

vi.mock('@/db/queries/whatsapp', () => ({
  upsertConversation: vi.fn(),
  createMessage: vi.fn(),
  incrementUnreadCount: vi.fn(),
  updateMessageStatus: vi.fn(),
  pushSseEvent: vi.fn(),
  getMessageByMetaId: vi.fn(),
  getRecentInboundBodies: vi.fn(),
  getQueuedMessages: vi.fn(() => []),
  updateQueuedMessageStatus: vi.fn(),
  expireStaleQueuedMessages: vi.fn(() => []),
  listAutomations: vi.fn(() => []),
}))

vi.mock('@/db/queries/appointments', () => ({
  getAppointmentByConfirmationMessageId: vi.fn(),
  confirmAppointment: vi.fn(),
  requestReschedule: vi.fn(),
}))

vi.mock('@/db/queries/anamnesis', () => ({
  getAnamnesis: vi.fn(),
}))

vi.mock('@/db/queries/anamnesis-tokens', () => ({
  createAnamnesisToken: vi.fn(),
}))

vi.mock('@/db/queries/prospects', () => ({
  createNewProspect: vi.fn(),
  getProspectByPhone: vi.fn(),
  updateProspect: vi.fn(),
  logProspectActivity: vi.fn(),
  setProspectProcedures: vi.fn(),
}))

vi.mock('@/db/queries/patients', () => ({
  getPatientByPhone: vi.fn(),
  getPatient: vi.fn(),
}))

vi.mock('@/db/queries/tenants', () => ({
  getTenant: vi.fn(),
}))

vi.mock('@/lib/classify-prospect', () => ({
  classifyMessage: vi.fn(),
}))

// ---------------------------------------------------------------------------
// Imports under test (after mocks)
// ---------------------------------------------------------------------------

import { db } from '@/db/client'
import { verifyWebhookSignature } from '@/lib/whatsapp'
import {
  upsertConversation,
  createMessage,
  incrementUnreadCount,
  updateMessageStatus,
  pushSseEvent,
  getMessageByMetaId,
} from '@/db/queries/whatsapp'
import { getProspectByPhone } from '@/db/queries/prospects'
import { getPatientByPhone } from '@/db/queries/patients'
import { NextRequest } from 'next/server'
import { POST } from '../route'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_APP_SECRET = 'test-app-secret'
const SHARED_PHONE_NUMBER_ID = 'floraclin-shared-waba-id'
const PATIENT_PHONE = '5511999990000'
const TENANT_A = 'tenant-a'
const TENANT_B = 'tenant-b'
const CONVERSATION_ID = 'conv-1'
const META_MSG_ID = 'wamid.incoming'
const CONTEXT_MSG_ID = 'wamid.previous-outbound'

function sign(body: string, secret: string): string {
  const hmac = crypto.createHmac('sha256', secret).update(body).digest('hex')
  return `sha256=${hmac}`
}

function makeRequest(body: unknown): NextRequest {
  const raw = JSON.stringify(body)
  return new NextRequest('http://localhost/api/webhooks/whatsapp', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-hub-signature-256': sign(raw, TEST_APP_SECRET),
    },
    body: raw,
  })
}

function makeInboundPayload(opts: { contextId?: string }) {
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
              contacts: [{ wa_id: PATIENT_PHONE, profile: { name: 'Maria' } }],
              messages: [
                {
                  id: META_MSG_ID,
                  from: PATIENT_PHONE,
                  timestamp: String(Math.floor(Date.now() / 1000)),
                  type: 'text',
                  text: { body: 'Oi, quero remarcar' },
                  ...(opts.contextId ? { context: { id: opts.contextId } } : {}),
                },
              ],
            },
          },
        ],
      },
    ],
  }
}

function makeStatusPayload(statusId: string) {
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
              statuses: [
                {
                  id: statusId,
                  status: 'delivered',
                  timestamp: String(Math.floor(Date.now() / 1000)),
                  recipient_id: PATIENT_PHONE,
                },
              ],
            },
          },
        ],
      },
    ],
  }
}

function setupCommonInboundMocks() {
  vi.mocked(verifyWebhookSignature).mockReturnValue(true)
  vi.mocked(getMessageByMetaId).mockResolvedValue(null as never)
  vi.mocked(getProspectByPhone).mockResolvedValue({
    id: 'prospect-1',
    stage: 'qualificado',
    createdAt: new Date().toISOString(),
  } as never)
  vi.mocked(getPatientByPhone).mockResolvedValue(null as never)
  vi.mocked(upsertConversation).mockResolvedValue({ id: CONVERSATION_ID } as never)
  vi.mocked(createMessage).mockResolvedValue({ id: 'msg-1', conversationId: CONVERSATION_ID } as never)
  vi.mocked(incrementUnreadCount).mockResolvedValue(undefined as never)
  vi.mocked(pushSseEvent).mockResolvedValue(undefined as never)
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.META_APP_SECRET = TEST_APP_SECRET
  process.env.NEXT_PUBLIC_APP_URL = 'https://app.floraclin.com.br'
  process.env.FLORACLIN_WA_PHONE_NUMBER_ID = SHARED_PHONE_NUMBER_ID
  setupCommonInboundMocks()
})

describe('resolveSharedNumberTenant — reply context wins over phone history', () => {
  it('routes to the tenant owning the replied-to message, even when a different tenant messaged this phone more recently', async () => {
    // db.select(...).from(whatsappMessages).where(meta_message_id = contextId).limit(1)
    // resolves to TENANT_A, the owner of the message being replied to.
    vi.mocked(db.select).mockReturnValueOnce(
      makeSelectChain([{ tenantId: TENANT_A }]) as never,
    )

    const payload = makeInboundPayload({ contextId: CONTEXT_MSG_ID })
    await POST(makeRequest(payload))

    await vi.waitFor(() => {
      expect(upsertConversation).toHaveBeenCalledWith(
        TENANT_A,
        PATIENT_PHONE,
        'Maria',
        'prospect-1',
        null,
      )
    })

    // Phone-history fallback must never be consulted -- context resolved it.
    expect(db.selectDistinct).not.toHaveBeenCalled()
  })
})

describe('resolveSharedNumberTenant — phone history, unambiguous', () => {
  it('routes to the single tenant that has ever conversed with this phone when there is no context id', async () => {
    vi.mocked(db.selectDistinct).mockReturnValueOnce(
      makeSelectChain([{ tenantId: TENANT_B }]) as never,
    )

    const payload = makeInboundPayload({})
    await POST(makeRequest(payload))

    await vi.waitFor(() => {
      expect(upsertConversation).toHaveBeenCalledWith(
        TENANT_B,
        PATIENT_PHONE,
        'Maria',
        'prospect-1',
        null,
      )
    })

    expect(db.select).not.toHaveBeenCalled()
  })
})

describe('resolveSharedNumberTenant — phone history, ambiguous', () => {
  it('does not route and reports to Sentry when two tenants share the phone and there is no context id', async () => {
    vi.mocked(db.selectDistinct).mockReturnValueOnce(
      makeSelectChain([{ tenantId: TENANT_A }, { tenantId: TENANT_B }]) as never,
    )

    const payload = makeInboundPayload({})
    await POST(makeRequest(payload))

    await new Promise((r) => setTimeout(r, 50))

    expect(upsertConversation).not.toHaveBeenCalled()
    expect(captureExceptionMock).toHaveBeenCalledTimes(1)
    const [, ctx] = captureExceptionMock.mock.calls[0]
    expect(ctx).toMatchObject({
      extra: {
        phone: PATIENT_PHONE,
        candidateTenantIds: [TENANT_A, TENANT_B],
      },
    })
  })
})

describe('resolveSharedNumberTenant — unknown context id falls through to phone rules', () => {
  it('falls back to phone history when the context id does not match any known message', async () => {
    // Context lookup finds nothing.
    vi.mocked(db.select).mockReturnValueOnce(makeSelectChain([]) as never)
    // Phone-history fallback finds exactly one tenant.
    vi.mocked(db.selectDistinct).mockReturnValueOnce(
      makeSelectChain([{ tenantId: TENANT_B }]) as never,
    )

    const payload = makeInboundPayload({ contextId: 'wamid.unknown' })
    await POST(makeRequest(payload))

    await vi.waitFor(() => {
      expect(upsertConversation).toHaveBeenCalledWith(
        TENANT_B,
        PATIENT_PHONE,
        'Maria',
        'prospect-1',
        null,
      )
    })

    expect(db.select).toHaveBeenCalledTimes(1)
    expect(db.selectDistinct).toHaveBeenCalledTimes(1)
  })
})

describe('resolveSharedNumberTenant — status updates', () => {
  it('resolves the owning tenant from the status message id and processes the update', async () => {
    vi.mocked(db.select).mockReturnValueOnce(
      makeSelectChain([{ tenantId: TENANT_A }]) as never,
    )
    vi.mocked(updateMessageStatus).mockResolvedValue({
      conversationId: CONVERSATION_ID,
    } as never)

    const statusMsgId = 'wamid.status-target'
    const payload = makeStatusPayload(statusMsgId)
    await POST(makeRequest(payload))

    await vi.waitFor(() => {
      expect(updateMessageStatus).toHaveBeenCalledWith(
        TENANT_A,
        statusMsgId,
        'delivered',
        null,
      )
    })

    expect(db.selectDistinct).not.toHaveBeenCalled()
  })

  it('falls back to phone history for a status update when the message id is unknown', async () => {
    vi.mocked(db.select).mockReturnValueOnce(makeSelectChain([]) as never)
    vi.mocked(db.selectDistinct).mockReturnValueOnce(
      makeSelectChain([{ tenantId: TENANT_B }]) as never,
    )
    vi.mocked(updateMessageStatus).mockResolvedValue({
      conversationId: CONVERSATION_ID,
    } as never)

    const statusMsgId = 'wamid.unknown-status'
    const payload = makeStatusPayload(statusMsgId)
    await POST(makeRequest(payload))

    await vi.waitFor(() => {
      expect(updateMessageStatus).toHaveBeenCalledWith(
        TENANT_B,
        statusMsgId,
        'delivered',
        null,
      )
    })
  })

  it('drops the status update when tenant resolution is ambiguous', async () => {
    vi.mocked(db.select).mockReturnValueOnce(makeSelectChain([]) as never)
    vi.mocked(db.selectDistinct).mockReturnValueOnce(
      makeSelectChain([{ tenantId: TENANT_A }, { tenantId: TENANT_B }]) as never,
    )

    const payload = makeStatusPayload('wamid.ambiguous-status')
    await POST(makeRequest(payload))

    await new Promise((r) => setTimeout(r, 50))

    expect(updateMessageStatus).not.toHaveBeenCalled()
    expect(captureExceptionMock).toHaveBeenCalledTimes(1)
  })
})
