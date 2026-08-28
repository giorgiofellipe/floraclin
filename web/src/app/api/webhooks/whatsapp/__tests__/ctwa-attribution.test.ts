/**
 * Click-to-WhatsApp (CTWA) attribution capture on inbound webhook messages.
 *
 * Every inbound message writes exactly one lead_attributions row, whether or
 * not the message carries a `referral` object, and a brand new prospect
 * emits exactly one Meta Lead event. See
 * docs/plans/2026-08-28-meta-conversions-cook.md, Task D1.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import crypto from 'crypto'

const { attributionStore } = vi.hoisted(() => ({
  attributionStore: new Map<string, Record<string, unknown>>(),
}))

// ---------------------------------------------------------------------------
// Mocks — hoisted by vitest, declared before any imports from the module
// ---------------------------------------------------------------------------

vi.mock('@/db/client', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(() => []),
        })),
      })),
    })),
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
  procedureTypes: { id: 'id', name: 'name', tenantId: 'tenant_id', defaultPrice: 'default_price' },
  whatsappMessages: { tenantId: 'tenant_id', metaMessageId: 'meta_message_id', mediaUrl: 'media_url' },
  whatsappConversations: {
    tenantId: 'tenant_id',
    phoneNumber: 'phone_number',
    lastMessageAt: 'last_message_at',
  },
}))

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((...args: unknown[]) => args),
  and: vi.fn((...args: unknown[]) => args),
  desc: vi.fn((c: unknown) => c),
  sql: vi.fn(),
}))

vi.mock('@/lib/whatsapp', () => ({
  verifyWebhookSignature: vi.fn(() => true),
  downloadAndStoreMedia: vi.fn(),
  sendTextMessage: vi.fn(),
  sendTemplateMessage: vi.fn(),
  sendMediaMessage: vi.fn(),
  normalizeBrPhone: vi.fn((phone: string) => phone),
  getTemplateForTenant: vi.fn(),
  CreditExhaustedError: class CreditExhaustedError extends Error {},
}))

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
  createNewProspect: vi.fn(),
  getProspectByPhone: vi.fn(),
  updateProspect: vi.fn(),
  logProspectActivity: vi.fn(),
  setProspectProcedures: vi.fn(),
}))
vi.mock('@/db/queries/patients', () => ({
  getPatientByPhone: vi.fn(async () => null),
  getPatient: vi.fn(),
}))
vi.mock('@/db/queries/tenants', () => ({ getTenant: vi.fn() }))
vi.mock('@/lib/classify-prospect', () => ({ classifyMessage: vi.fn() }))

// `recordAttribution` simulates the real query's unique-index first-touch
// rule (onConflictDoNothing on prospectId), so the "does not downgrade" test
// exercises that guarantee rather than just spying on call arguments.
vi.mock('@/db/queries/lead-attributions', () => ({
  recordAttribution: vi.fn(async (input: { prospectId: string }) => {
    if (attributionStore.has(input.prospectId)) return { recorded: false }
    attributionStore.set(input.prospectId, input)
    return { recorded: true }
  }),
}))
vi.mock('@/lib/meta/events', () => ({
  enqueueMetaEvent: vi.fn(async () => {}),
}))

// ---------------------------------------------------------------------------
// Imports under test (after mocks)
// ---------------------------------------------------------------------------

import { db } from '@/db/client'
import { getMessageByMetaId } from '@/db/queries/whatsapp'
import { createNewProspect, getProspectByPhone } from '@/db/queries/prospects'
import { getPatientByPhone } from '@/db/queries/patients'
import { recordAttribution } from '@/db/queries/lead-attributions'
import { enqueueMetaEvent } from '@/lib/meta/events'
import { POST } from '../route'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_APP_SECRET = 'test-app-secret'
const TENANT_ID = 'tenant-1'
const PHONE_NUMBER_ID = 'waba-phone-id'
const PATIENT_PHONE = '5511999990000'
const PROSPECT_ID = 'prospect-1'

const FULL_REFERRAL = {
  source_url: 'https://fb.me/ad-click',
  source_id: 'ad-123',
  source_type: 'ad',
  headline: 'Botox a partir de R$500',
  body: 'Agende sua avaliação',
  media_type: 'image',
  image_url: 'https://example.com/img.jpg',
  ctwa_clid: 'ctwa-clid-abc',
}

function sign(body: string): string {
  return `sha256=${crypto.createHmac('sha256', TEST_APP_SECRET).update(body).digest('hex')}`
}

function makeRequest(body: unknown): NextRequest {
  const raw = JSON.stringify(body)
  return new NextRequest('http://localhost/api/webhooks/whatsapp', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-hub-signature-256': sign(raw),
    },
    body: raw,
  })
}

function makePayload(opts: { metaMessageId: string; referral?: Record<string, unknown> }) {
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
              metadata: { phone_number_id: PHONE_NUMBER_ID },
              contacts: [{ wa_id: PATIENT_PHONE, profile: { name: 'Maria' } }],
              messages: [
                {
                  id: opts.metaMessageId,
                  from: PATIENT_PHONE,
                  timestamp: String(Math.floor(Date.now() / 1000)),
                  type: 'text',
                  text: { body: 'Oi, quero saber mais' },
                  ...(opts.referral ? { referral: opts.referral } : {}),
                },
              ],
            },
          },
        ],
      },
    ],
  }
}

function setupTenantLookup() {
  vi.mocked(db.select).mockReturnValue({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue([
          { id: TENANT_ID, settings: { whatsapp_phone_number_id: PHONE_NUMBER_ID } },
        ]),
      }),
    }),
  } as never)
}

function existingProspect() {
  return {
    id: PROSPECT_ID,
    stage: 'qualificado',
    createdAt: new Date().toISOString(),
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks()
  attributionStore.clear()
  process.env.META_APP_SECRET = TEST_APP_SECRET
  setupTenantLookup()
  vi.mocked(getMessageByMetaId).mockResolvedValue(null as never)
  vi.mocked(getPatientByPhone).mockResolvedValue(null as never)
})

describe('CTWA attribution capture', () => {
  it('writes a ctwa attribution row with ctwa_clid intact for a full referral', async () => {
    vi.mocked(getProspectByPhone).mockResolvedValue(existingProspect() as never)

    const res = await POST(
      makeRequest(makePayload({ metaMessageId: 'wamid-1', referral: FULL_REFERRAL })),
    )
    expect(res.status).toBe(200)

    expect(recordAttribution).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT_ID,
        prospectId: PROSPECT_ID,
        channel: 'ctwa',
        ctwaClid: 'ctwa-clid-abc',
        adId: 'ad-123',
      }),
    )
  })

  it('writes an organic attribution row with no click ids when there is no referral', async () => {
    vi.mocked(getProspectByPhone).mockResolvedValue(existingProspect() as never)

    const res = await POST(makeRequest(makePayload({ metaMessageId: 'wamid-2' })))
    expect(res.status).toBe(200)

    expect(recordAttribution).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT_ID,
        prospectId: PROSPECT_ID,
        channel: 'organic',
        ctwaClid: null,
        adId: null,
      }),
    )
  })

  it('does not downgrade an existing ctwa row when a later message arrives organic', async () => {
    vi.mocked(getProspectByPhone).mockResolvedValue(existingProspect() as never)

    await POST(
      makeRequest(makePayload({ metaMessageId: 'wamid-3', referral: FULL_REFERRAL })),
    )
    await POST(makeRequest(makePayload({ metaMessageId: 'wamid-4' })))

    expect(attributionStore.get(PROSPECT_ID)).toMatchObject({
      channel: 'ctwa',
      ctwaClid: 'ctwa-clid-abc',
    })
  })
})

describe('Lead event emission', () => {
  it('emits exactly one Lead for a new prospect', async () => {
    vi.mocked(getProspectByPhone).mockResolvedValue(null as never)
    vi.mocked(createNewProspect).mockResolvedValue(existingProspect() as never)

    const res = await POST(makeRequest(makePayload({ metaMessageId: 'wamid-5' })))
    expect(res.status).toBe(200)

    expect(enqueueMetaEvent).toHaveBeenCalledTimes(1)
    expect(enqueueMetaEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: 'Lead',
        eventId: `lead:${PROSPECT_ID}`,
        actionSource: 'business_messaging',
        prospectId: PROSPECT_ID,
      }),
    )
  })

  it('emits no Lead for an existing prospect', async () => {
    vi.mocked(getProspectByPhone).mockResolvedValue(existingProspect() as never)

    const res = await POST(makeRequest(makePayload({ metaMessageId: 'wamid-6' })))
    expect(res.status).toBe(200)

    expect(enqueueMetaEvent).not.toHaveBeenCalled()
  })
})
