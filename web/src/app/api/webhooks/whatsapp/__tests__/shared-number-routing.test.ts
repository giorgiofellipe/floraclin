/**
 * Tests for shared-number tenant resolution in the WhatsApp webhook.
 *
 * This file merges two suites that were written independently against the
 * same path: the reply-context routing rules below, and the phone
 * canonicalization assertions at the end. The second set exists because the
 * cron stored one string and the webhook looked up another, so every inbound
 * message on the shared number was dropped before anything was written.
 * Keeping them together is deliberate: they exercise the same resolver
 * through the same entry point, and two files would mean two mock walls
 * drifting apart.
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
 * Builds a chainable object that mimics drizzle's query builder for all
 * shapes used by the resolver:
 *   - db.select(...).from(...).innerJoin(...).where(...).limit(1)  (message-id lookup)
 *   - db.select(...).from(...).where(...)                          (phone-history lookup, awaited directly)
 *
 * Both go through db.select, so tests that exercise the context path queue
 * the message lookup first and the phone-history lookup second.
 */
function makeSelectChain(result: unknown[]) {
  const promise = Object.assign(Promise.resolve(result), {
    limit: vi.fn().mockResolvedValue(result),
  })
  const whereStage = { where: vi.fn().mockReturnValue(promise) }
  return {
    from: vi.fn().mockReturnValue({
      innerJoin: vi.fn().mockReturnValue(whereStage),
      where: vi.fn().mockReturnValue(promise),
    }),
  }
}

// The route reports through reportWebhookFailure -> reportSideEffectFailure,
// which tags every report with an area and a step. Asserting on that wrapper
// rather than on Sentry directly keeps the tests honest about the tagging.
const reportSideEffectFailureMock = vi.fn()

vi.mock('@/lib/observability', () => ({
  reportSideEffectFailure: (...args: unknown[]) => reportSideEffectFailureMock(...args),
}))

vi.mock('@/db/client', () => ({
  db: {
    select: vi.fn(),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => ({
          returning: vi.fn(() => []),
        })),
      })),
    })),
  },
}))

// Attribution capture is a side effect of the meta conversions feature and is
// irrelevant to routing. Mock it so this suite does not need an insert-capable
// db stub.
vi.mock('@/db/queries/lead-attributions', () => ({
  recordAttribution: vi.fn(async () => ({ recorded: true })),
  getAttribution: vi.fn(async () => null),
}))

vi.mock('@/db/schema', () => ({
  tenants: { id: 'id', settings: 'settings' },
  tenantUsers: { tenantId: 'tenant_id', userId: 'user_id', role: 'role' },
  procedureTypes: { id: 'id', name: 'name', tenantId: 'tenant_id', defaultPrice: 'default_price' },
  whatsappMessages: {
    tenantId: 'tenant_id',
    metaMessageId: 'meta_message_id',
    mediaUrl: 'media_url',
    conversationId: 'conversation_id',
    direction: 'direction',
  },
  whatsappConversations: { id: 'id', tenantId: 'tenant_id', phoneNumber: 'phone_number', lastMessageAt: 'last_message_at' },
}))

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((column: unknown, value: unknown) => ({ column, value })),
  and: vi.fn((...args: unknown[]) => args),
  sql: vi.fn(),
}))

// normalizeBrPhone is NOT stubbed. Mocking it as the identity function is
// what let the original canonicalization bug through: the suite stayed green
// while the cron and the webhook produced different strings for one person.
vi.mock('@/lib/whatsapp', async () => {
  const { normalizeBrPhone } = await vi.importActual<typeof import('@/lib/phone')>('@/lib/phone')
  return {
  normalizeBrPhone,
  verifyWebhookSignature: vi.fn(),
  downloadAndStoreMedia: vi.fn(),
  sendTextMessage: vi.fn(),
  sendTemplateMessage: vi.fn(),
  sendMediaMessage: vi.fn(),
  getTemplateForTenant: vi.fn(),
  CreditExhaustedError: class CreditExhaustedError extends Error {
    constructor(public creditsUsed: number, public creditsTotal: number) {
      super(`Credits exhausted`)
      this.name = 'CreditExhaustedError'
    }
  },
  }
})

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
import { eq } from 'drizzle-orm'
import { POST } from '../route'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_APP_SECRET = 'test-app-secret'
const SHARED_PHONE_NUMBER_ID = 'floraclin-shared-waba-id'
// What Meta puts in `from`: Brazilian mobiles arrive without the 9th digit
// for accounts predating the 2012-2016 renumbering.
const PATIENT_PHONE = '554788443635'
// What the clinic typed into the patient record, and so what the cron stored.
const PATIENT_RECORD_PHONE = '(47) 98844-3635'
// The one canonical form both must collapse to.
const CANONICAL = '5547988443635'
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

/** A conversation row as the phone-history lookup now returns it. */
function convRow(tenantId: string, agoMs: number) {
  return { tenantId, lastMessageAt: new Date(Date.now() - agoMs) }
}
const MINUTES = 60 * 1000
const HOURS = 60 * MINUTES
const DAYS = 24 * HOURS

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
  // resetAllMocks (not clearAllMocks) so a queued mockReturnValueOnce/
  // mockImplementationOnce left unconsumed by one test (e.g. a phone-history
  // fallback deliberately never reached) cannot leak into the next test's
  // FIFO queue and shift its results.
  vi.resetAllMocks()
  process.env.META_APP_SECRET = TEST_APP_SECRET
  process.env.NEXT_PUBLIC_APP_URL = 'https://app.floraclin.com.br'
  process.env.FLORACLIN_WA_PHONE_NUMBER_ID = SHARED_PHONE_NUMBER_ID
  setupCommonInboundMocks()
})

describe('resolveSharedNumberTenant — reply context wins over phone history', () => {
  it('routes to the tenant owning the replied-to message, even when a different tenant messaged this phone more recently', async () => {
    // db.select(...).from(whatsappMessages).innerJoin(whatsappConversations)
    // .where(meta_message_id = contextId).limit(1) resolves to TENANT_A, the
    // owner of the outbound message being replied to, sent to this same phone.
    vi.mocked(db.select).mockReturnValueOnce(
      makeSelectChain([
        { tenantId: TENANT_A, direction: 'outbound', conversationPhone: PATIENT_PHONE },
      ]) as never,
    )

    const payload = makeInboundPayload({ contextId: CONTEXT_MSG_ID })
    await POST(makeRequest(payload))

    await vi.waitFor(() => {
      expect(upsertConversation).toHaveBeenCalledWith(
        TENANT_A,
        CANONICAL,
        'Maria',
        'prospect-1',
        null,
      )
    })

    // Phone-history fallback must never be consulted -- context resolved it.
    // Only the message-id lookup ran, so exactly one select.
    expect(db.select).toHaveBeenCalledTimes(1)
  })
})

describe('resolveSharedNumberTenant — reply context bound to the sender phone (security)', () => {
  it('refuses and reports to Sentry when the context id names a message sent to a DIFFERENT phone, without falling back to phone history', async () => {
    const OTHER_PHONE = '5511988887777'

    // The context id resolves, but the message it names was sent to a
    // different phone than the one that actually sent this inbound message.
    vi.mocked(db.select).mockReturnValueOnce(
      makeSelectChain([
        { tenantId: TENANT_A, direction: 'outbound', conversationPhone: OTHER_PHONE },
      ]) as never,
    )
    // Even though phone history WOULD resolve unambiguously if consulted,
    // it must never be reached -- prove that by making it return a single
    // candidate and asserting it's never called.
    // Phone history WOULD resolve unambiguously if consulted. Queue it so a
    // regression that falls through routes somewhere, then assert it never ran.
    vi.mocked(db.select).mockReturnValueOnce(
      makeSelectChain([convRow(TENANT_B, 1 * HOURS)]) as never,
    )

    const payload = makeInboundPayload({ contextId: CONTEXT_MSG_ID })
    await POST(makeRequest(payload))

    await vi.waitFor(() => expect(reportSideEffectFailureMock).toHaveBeenCalledTimes(1))

    expect(upsertConversation).not.toHaveBeenCalled()
    // One select: the message lookup. The queued phone-history chain is untouched.
    expect(db.select).toHaveBeenCalledTimes(1)
    const [, meta] = reportSideEffectFailureMock.mock.calls[0]
    expect(meta).toMatchObject({
      area: 'whatsapp-webhook',
      step: 'shared_context_phone_mismatch',
      extra: { messageId: CONTEXT_MSG_ID, phone: CANONICAL, tenantId: TENANT_A },
    })
  })

  it('does not accept a context id that points at an INBOUND message as a routing key, and falls back to phone history instead', async () => {
    // The context id resolves to a real message with a matching phone, but
    // it's a message the sender wrote (inbound), not one we sent -- it must
    // not be treated as an exact match.
    vi.mocked(db.select).mockReturnValueOnce(
      makeSelectChain([
        { tenantId: TENANT_A, direction: 'inbound', conversationPhone: PATIENT_PHONE },
      ]) as never,
    )
    vi.mocked(db.select).mockReturnValueOnce(
      makeSelectChain([convRow(TENANT_B, 1 * HOURS)]) as never,
    )

    const payload = makeInboundPayload({ contextId: CONTEXT_MSG_ID })
    await POST(makeRequest(payload))

    await vi.waitFor(() => {
      expect(upsertConversation).toHaveBeenCalledWith(
        TENANT_B,
        CANONICAL,
        'Maria',
        'prospect-1',
        null,
      )
    })

    expect(reportSideEffectFailureMock).not.toHaveBeenCalled()
  })
})

describe('resolveSharedNumberTenant — phone history, unambiguous', () => {
  it('routes to the single tenant that has ever conversed with this phone when there is no context id', async () => {
    // Two rows, one tenant: the same clinic can hold more than one row only
    // through data drift, and it must still resolve rather than look ambiguous.
    vi.mocked(db.select).mockReturnValueOnce(
      makeSelectChain([convRow(TENANT_B, 40 * DAYS), convRow(TENANT_B, 90 * DAYS)]) as never,
    )

    const payload = makeInboundPayload({})
    await POST(makeRequest(payload))

    await vi.waitFor(() => {
      expect(upsertConversation).toHaveBeenCalledWith(
        TENANT_B,
        CANONICAL,
        'Maria',
        'prospect-1',
        null,
      )
    })

    // No context id, so the message lookup is skipped entirely.
    expect(db.select).toHaveBeenCalledTimes(1)
  })
})

describe('resolveSharedNumberTenant — phone history, ambiguous', () => {
  it('refuses and reports when two tenants share the phone and neither is recently active', async () => {
    vi.mocked(db.select).mockReturnValueOnce(
      makeSelectChain([convRow(TENANT_A, 30 * DAYS), convRow(TENANT_B, 60 * DAYS)]) as never,
    )

    const payload = makeInboundPayload({})
    await POST(makeRequest(payload))

    await vi.waitFor(() => expect(reportSideEffectFailureMock).toHaveBeenCalledTimes(1))

    expect(upsertConversation).not.toHaveBeenCalled()
    const [err, meta] = reportSideEffectFailureMock.mock.calls[0]
    expect((err as Error).message).toMatch(/ambiguous/i)
    expect(meta).toMatchObject({
      area: 'whatsapp-webhook',
      step: 'shared_tenant_ambiguous',
      extra: { phone: CANONICAL, candidateTenantIds: [TENANT_A, TENANT_B], recentTenantIds: [] },
    })
  })

  it('routes to the only recently active tenant instead of dropping the message', async () => {
    // The sequence this tier exists for: the patient confirms with clinic A
    // (routed exactly, by context id), then types a follow-up seconds later
    // with no context. Clinic B has a stale conversation for the same phone.
    // Refusing here would silently lose the follow-up.
    vi.mocked(db.select).mockReturnValueOnce(
      makeSelectChain([convRow(TENANT_A, 5 * MINUTES), convRow(TENANT_B, 40 * DAYS)]) as never,
    )

    const payload = makeInboundPayload({})
    await POST(makeRequest(payload))

    await vi.waitFor(() => {
      expect(upsertConversation).toHaveBeenCalledWith(
        TENANT_A,
        CANONICAL,
        'Maria',
        'prospect-1',
        null,
      )
    })

    expect(reportSideEffectFailureMock).not.toHaveBeenCalled()
  })

  it('still refuses when both tenants are active inside the window', async () => {
    // Recency cannot separate them, so guessing would cross a clinic boundary.
    vi.mocked(db.select).mockReturnValueOnce(
      makeSelectChain([convRow(TENANT_A, 2 * HOURS), convRow(TENANT_B, 3 * HOURS)]) as never,
    )

    const payload = makeInboundPayload({})
    await POST(makeRequest(payload))

    await vi.waitFor(() => expect(reportSideEffectFailureMock).toHaveBeenCalledTimes(1))

    expect(upsertConversation).not.toHaveBeenCalled()
    const [, meta] = reportSideEffectFailureMock.mock.calls[0]
    expect(meta).toMatchObject({
      step: 'shared_tenant_ambiguous',
      extra: { recentTenantIds: [TENANT_A, TENANT_B] },
    })
  })

  it('treats a conversation with no lastMessageAt as not recent', async () => {
    vi.mocked(db.select).mockReturnValueOnce(
      makeSelectChain([
        { tenantId: TENANT_A, lastMessageAt: null },
        convRow(TENANT_B, 40 * DAYS),
      ]) as never,
    )

    const payload = makeInboundPayload({})
    await POST(makeRequest(payload))

    await vi.waitFor(() => expect(reportSideEffectFailureMock).toHaveBeenCalledTimes(1))
    expect(upsertConversation).not.toHaveBeenCalled()
  })
})

describe('resolveSharedNumberTenant — phone history, zero candidates', () => {
  it('drops the message without raising an alert, since a cold inbound is ordinary traffic', async () => {
    // On the shared number a conversation row only exists once a clinic has
    // messaged the person, so every wrong number and every bit of spam lands
    // here. Reporting it would page through the Sentry to Discord route on
    // traffic that is working as designed.
    vi.mocked(db.select).mockReturnValueOnce(makeSelectChain([]) as never)

    const payload = makeInboundPayload({})
    await POST(makeRequest(payload))

    await vi.waitFor(() => expect(db.select).toHaveBeenCalledTimes(1))

    expect(upsertConversation).not.toHaveBeenCalled()
    expect(reportSideEffectFailureMock).not.toHaveBeenCalled()
  })
})

describe('resolveSharedNumberTenant — unknown context id falls through to phone rules', () => {
  it('falls back to phone history when the context id does not match any known message', async () => {
    // Context lookup finds nothing.
    vi.mocked(db.select).mockReturnValueOnce(makeSelectChain([]) as never)
    // Phone-history fallback finds exactly one tenant.
    vi.mocked(db.select).mockReturnValueOnce(
      makeSelectChain([convRow(TENANT_B, 1 * HOURS)]) as never,
    )

    const payload = makeInboundPayload({ contextId: 'wamid.unknown' })
    await POST(makeRequest(payload))

    await vi.waitFor(() => {
      expect(upsertConversation).toHaveBeenCalledWith(
        TENANT_B,
        CANONICAL,
        'Maria',
        'prospect-1',
        null,
      )
    })

    // Message lookup then phone history.
    expect(db.select).toHaveBeenCalledTimes(2)
  })
})

describe('resolveSharedNumberTenant — status updates', () => {
  it('resolves the owning tenant from the status message id and processes the update', async () => {
    vi.mocked(db.select).mockReturnValueOnce(
      makeSelectChain([
        { tenantId: TENANT_A, direction: 'outbound', conversationPhone: PATIENT_PHONE },
      ]) as never,
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

    // The status id resolved, so phone history was never consulted.
    expect(db.select).toHaveBeenCalledTimes(1)
  })

  it('falls back to phone history for a status update when the message id is unknown', async () => {
    vi.mocked(db.select).mockReturnValueOnce(makeSelectChain([]) as never)
    vi.mocked(db.select).mockReturnValueOnce(
      makeSelectChain([convRow(TENANT_B, 1 * HOURS)]) as never,
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
    vi.mocked(db.select).mockReturnValueOnce(
      makeSelectChain([convRow(TENANT_A, 30 * DAYS), convRow(TENANT_B, 60 * DAYS)]) as never,
    )

    const payload = makeStatusPayload('wamid.ambiguous-status')
    await POST(makeRequest(payload))

    await vi.waitFor(() => expect(reportSideEffectFailureMock).toHaveBeenCalledTimes(1))
    expect(updateMessageStatus).not.toHaveBeenCalled()
  })
})

describe('phone canonicalization', () => {
  // The bug that made every inbound message on the shared number disappear:
  // the cron stored the patient-record form and the webhook looked up the
  // Meta form, and the conversation lookup matches by string equality.
  it('collapses the patient-record form and the Meta form to one string', async () => {
    const { normalizeBrPhone } = await vi.importActual<typeof import('@/lib/phone')>('@/lib/phone')
    expect(normalizeBrPhone(PATIENT_RECORD_PHONE)).toBe(CANONICAL)
    expect(normalizeBrPhone(PATIENT_PHONE)).toBe(CANONICAL)
  })

  it('looks the conversation up by the same string the cron stored', async () => {
    vi.mocked(db.select).mockReturnValueOnce(
      makeSelectChain([convRow(TENANT_B, 1 * HOURS)]) as never,
    )

    await POST(makeRequest(makeInboundPayload({})))
    await vi.waitFor(() => expect(upsertConversation).toHaveBeenCalled())

    // `eq` echoes its arguments, so this reads the actual lookup key rather
    // than a value the test made up.
    const comparedPhones = (vi.mocked(eq).mock.calls as unknown as [string, string][])
      .filter(([column]) => column === 'phone_number')
      .map(([, value]) => value)

    expect(comparedPhones).toContain(CANONICAL)
    // The pre-fix value. If this returns, replies stop being routed.
    expect(comparedPhones).not.toContain('47988443635')
  })
})
