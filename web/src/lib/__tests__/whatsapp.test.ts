import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import crypto from 'crypto'

vi.mock('@/db/queries/tenants', () => ({
  getTenant: vi.fn(async () => ({
    id: 'tenant-1',
    settings: {
      whatsapp_enabled: true,
      whatsapp_mode: 'own',
      whatsapp_phone_number_id: 'phone-id',
      whatsapp_access_token: 'access-token',
      whatsapp_business_account_id: 'biz-id',
    },
  })),
}))

vi.mock('@/lib/plans', () => ({
  requireActiveSubscription: vi.fn(async () => undefined),
}))

const upsertTemplateMock = vi.fn(async (_tenantId: string, _template: { name: string }) => ({}))
const markStaleTemplatesMock = vi.fn(async (_tenantId: string, _metaTemplateIds: string[]) => 0)

const getSendableTemplateMock = vi.fn()

vi.mock('@/db/queries/whatsapp', () => ({
  upsertTemplate: upsertTemplateMock,
  markStaleTemplates: markStaleTemplatesMock,
  getSendableTemplate: getSendableTemplateMock,
}))

const consumeCreditsMock = vi.fn()
const refundCreditsMock = vi.fn(async () => undefined)
const recordChargeMock = vi.fn(async () => undefined)
const getOrCreateCurrentPeriodMock = vi.fn()

vi.mock('@/db/queries/whatsapp-credits', () => ({
  consumeCredits: consumeCreditsMock,
  refundCredits: refundCreditsMock,
  recordCharge: recordChargeMock,
  getOrCreateCurrentPeriod: getOrCreateCurrentPeriodMock,
}))

import { getTenant } from '@/db/queries/tenants'
import {
  verifyWebhookSignature,
  sendMediaMessage,
  sendTemplateMessage,
  sendTextMessage,
  requireCredits,
  pendingQueueCost,
  syncTemplatesForTenant,
} from '../whatsapp'
import { CreditExhaustedError, WhatsAppTemplateNotFoundError } from '../whatsapp-credits'

describe('verifyWebhookSignature', () => {
  it('returns true for valid signature', () => {
    const secret = 'test-secret'
    const payload = '{"test":"data"}'
    const hmac = crypto.createHmac('sha256', secret).update(payload).digest('hex')
    expect(verifyWebhookSignature(payload, `sha256=${hmac}`, secret)).toBe(true)
  })

  it('returns false for invalid signature', () => {
    const secret = 'test-secret'
    const payload = '{"test":"data"}'
    const hmac = crypto.createHmac('sha256', secret).update(payload).digest('hex')
    // Replace last char to make it invalid but same length
    const invalidHmac = hmac.slice(0, -1) + (hmac.slice(-1) === '0' ? '1' : '0')
    expect(verifyWebhookSignature(payload, `sha256=${invalidHmac}`, secret)).toBe(false)
  })

  it('returns false for mismatched length signature', () => {
    expect(verifyWebhookSignature('payload', 'sha256=short', 'secret')).toBe(false)
  })
})

describe('sendMediaMessage', () => {
  const originalFetch = global.fetch

  beforeEach(() => {
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ messages: [{ id: 'wamid.123' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ) as unknown as typeof fetch
  })

  afterEach(() => {
    global.fetch = originalFetch
    vi.clearAllMocks()
  })

  it('includes filename in document payload when provided', async () => {
    await sendMediaMessage(
      'tenant-1',
      '+5511999999999',
      'document',
      'https://example.com/doc.pdf',
      'Receita - João',
      'receita-joao.pdf',
    )
    const call = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    const body = JSON.parse((call[1] as RequestInit).body as string)
    expect(body.document).toEqual({
      link: 'https://example.com/doc.pdf',
      caption: 'Receita - João',
      filename: 'receita-joao.pdf',
    })
  })

  it('omits filename for non-document media types', async () => {
    await sendMediaMessage(
      'tenant-1',
      '+5511999999999',
      'image',
      'https://example.com/img.jpg',
      undefined,
      'should-be-ignored.jpg',
    )
    const call = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    const body = JSON.parse((call[1] as RequestInit).body as string)
    expect(body.image).toEqual({ link: 'https://example.com/img.jpg' })
    expect(body.image.filename).toBeUndefined()
  })

  it('omits filename when not provided for a document', async () => {
    await sendMediaMessage(
      'tenant-1',
      '+5511999999999',
      'document',
      'https://example.com/doc.pdf',
    )
    const call = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    const body = JSON.parse((call[1] as RequestInit).body as string)
    expect(body.document).toEqual({ link: 'https://example.com/doc.pdf' })
  })
})

describe('credits on the shared number', () => {
  const originalFetch = global.fetch

  beforeEach(() => {
    vi.stubEnv('FLORACLIN_WA_PHONE_NUMBER_ID', 'fc-phone')
    vi.stubEnv('FLORACLIN_WA_ACCESS_TOKEN', 'fc-token')
    vi.stubEnv('FLORACLIN_WA_BUSINESS_ACCOUNT_ID', 'fc-biz')
    vi.mocked(getTenant).mockResolvedValue({
      id: 'tenant-1',
      settings: { whatsapp_mode: 'floraclin' },
    } as Awaited<ReturnType<typeof getTenant>>)
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ messages: [{ id: 'wamid.123' }] }), { status: 200 }),
    ) as unknown as typeof fetch
    consumeCreditsMock.mockResolvedValue({
      allowed: true,
      periodId: 'period-1',
      creditsUsed: 1,
      creditsTotal: 300,
    })
  })

  afterEach(() => {
    global.fetch = originalFetch
    vi.unstubAllEnvs()
    vi.mocked(getTenant).mockReset()
    vi.clearAllMocks()
  })

  it.each([
    ['MARKETING', 3],
    ['UTILITY', 1],
  ])('charges a %s template %i credits and records the charge', async (category, cost) => {
    getSendableTemplateMock.mockResolvedValue({ name: 'tpl', language: 'pt_BR', category })

    await sendTemplateMessage('tenant-1', '5511999999999', 'tpl', 'pt_BR')

    expect(consumeCreditsMock).toHaveBeenCalledWith('tenant-1', cost)
    expect(recordChargeMock).toHaveBeenCalledWith('tenant-1', 'period-1', 'wamid.123', cost)
  })

  it.each([
    ['text', () => sendTextMessage('tenant-1', '5511999999999', 'Olá')],
    ['media', () => sendMediaMessage('tenant-1', '5511999999999', 'image', 'https://example.com/a.jpg')],
  ])('charges a free-form %s message 1 credit', async (_kind, send) => {
    await send()

    expect(consumeCreditsMock).toHaveBeenCalledWith('tenant-1', 1)
  })

  it('never charges a tenant on its own number', async () => {
    vi.mocked(getTenant).mockResolvedValue({
      id: 'tenant-1',
      settings: {
        whatsapp_mode: 'own',
        whatsapp_enabled: true,
        whatsapp_phone_number_id: 'own-phone',
        whatsapp_access_token: 'own-token',
        whatsapp_business_account_id: 'own-biz',
      },
    } as Awaited<ReturnType<typeof getTenant>>)

    await sendTemplateMessage('tenant-1', '5511999999999', 'tpl', 'pt_BR')
    await sendTextMessage('tenant-1', '5511999999999', 'Olá')

    expect(consumeCreditsMock).not.toHaveBeenCalled()
    expect(global.fetch).toHaveBeenCalledTimes(2)
  })

  it('blocks a template that is neither the tenant\'s nor a system one', async () => {
    getSendableTemplateMock.mockResolvedValue(null)

    await expect(
      sendTemplateMessage('tenant-1', '5511999999999', 'other_clinic_promo', 'pt_BR'),
    ).rejects.toBeInstanceOf(WhatsAppTemplateNotFoundError)

    expect(consumeCreditsMock).not.toHaveBeenCalled()
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it.each([
    ['rejects the send', { error: { message: 'paused' } }, 400],
    ['returns no message id', { messages: [] }, 200],
  ])('refunds the credits when Meta %s', async (_label, response, status) => {
    getSendableTemplateMock.mockResolvedValue({ name: 'tpl', language: 'pt_BR', category: 'MARKETING' })
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify(response), { status }),
    ) as unknown as typeof fetch

    await expect(
      sendTemplateMessage('tenant-1', '5511999999999', 'tpl', 'pt_BR'),
    ).rejects.toThrow('Meta API error')

    expect(refundCreditsMock).toHaveBeenCalledWith('period-1', 3)
    expect(recordChargeMock).not.toHaveBeenCalled()
  })

  it('keeps the Meta error when the refund itself fails', async () => {
    getSendableTemplateMock.mockResolvedValue({ name: 'tpl', language: 'pt_BR', category: 'UTILITY' })
    refundCreditsMock.mockRejectedValueOnce(new Error('db down'))
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ error: { message: 'paused' } }), { status: 400 }),
    ) as unknown as typeof fetch

    await expect(
      sendTemplateMessage('tenant-1', '5511999999999', 'tpl', 'pt_BR'),
    ).rejects.toThrow('Meta API error')
  })

  // The first queued message also pays the resume template: 2 credits.
  it.each([
    [298, 0],
    [297, 2],
  ])('allows a new queued message at %i/300 with %i queued', async (used, queued) => {
    getOrCreateCurrentPeriodMock.mockResolvedValue({ creditsUsed: used, creditsTotal: 300 })

    await expect(requireCredits('tenant-1', pendingQueueCost(queued))).resolves.toBeUndefined()
  })

  it.each([
    [299, 0],
    [298, 2],
  ])('blocks a new queued message at %i/300 with %i queued', async (used, queued) => {
    getOrCreateCurrentPeriodMock.mockResolvedValue({ creditsUsed: used, creditsTotal: 300 })

    await expect(requireCredits('tenant-1', pendingQueueCost(queued))).rejects.toBeInstanceOf(CreditExhaustedError)
  })

  it('never blocks the queue on an unlimited plan', async () => {
    getOrCreateCurrentPeriodMock.mockResolvedValue({ creditsUsed: 5000, creditsTotal: -1 })

    await expect(requireCredits('tenant-1', pendingQueueCost(19))).resolves.toBeUndefined()
  })
})

describe('syncTemplatesForTenant', () => {
  const originalFetch = global.fetch

  const metaTemplates = [
    { id: 'meta-1', name: 'dra_micaela_floriani_confirm_appointment', language: 'pt_BR', category: 'UTILITY', status: 'APPROVED', components: [] },
    { id: 'meta-2', name: 'dra_micaela_floriani_follow_up', language: 'pt_BR', category: 'UTILITY', status: 'APPROVED', components: [] },
    // Foreign templates that belong to other tenants on the shared WABA.
    { id: 'meta-3', name: 'dra_nicole_biomedica_esteta_confirm_appointment', language: 'pt_BR', category: 'UTILITY', status: 'APPROVED', components: [] },
    { id: 'meta-4', name: 'clinica_floraclin_reactivation', language: 'pt_BR', category: 'MARKETING', status: 'APPROVED', components: [] },
  ]

  beforeEach(() => {
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ data: metaTemplates }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ) as unknown as typeof fetch
    upsertTemplateMock.mockClear()
    markStaleTemplatesMock.mockClear()
  })

  afterEach(() => {
    global.fetch = originalFetch
    vi.clearAllMocks()
  })

  it('upserts only templates matching this tenant prefix and skips the rest', async () => {
    const result = await syncTemplatesForTenant('tenant-1', 'dra_micaela_floriani')

    expect(result.synced).toBe(2)
    expect(result.skipped).toBe(2)
    expect(upsertTemplateMock).toHaveBeenCalledTimes(2)
    const upsertedNames = upsertTemplateMock.mock.calls.map((call) => call[1].name)
    expect(upsertedNames).toEqual([
      'dra_micaela_floriani_confirm_appointment',
      'dra_micaela_floriani_follow_up',
    ])
  })

  it('feeds markStaleTemplates the same filtered id list that was upserted, not every id from Meta', async () => {
    await syncTemplatesForTenant('tenant-1', 'dra_micaela_floriani')

    expect(markStaleTemplatesMock).toHaveBeenCalledTimes(1)
    const [, idsPassed] = markStaleTemplatesMock.mock.calls[0]
    expect(idsPassed).toEqual(['meta-1', 'meta-2'])
    // Foreign ids must never reach markStaleTemplates for this tenant --
    // otherwise a row that legitimately belongs to another tenant, or a
    // stray foreign row already sitting here, gets an inconsistent verdict.
    expect(idsPassed).not.toContain('meta-3')
    expect(idsPassed).not.toContain('meta-4')
  })

  it('reports every template as skipped when no template matches the prefix', async () => {
    const result = await syncTemplatesForTenant('tenant-1', 'some_other_clinic')
    expect(result.synced).toBe(0)
    expect(result.skipped).toBe(4)
    expect(upsertTemplateMock).not.toHaveBeenCalled()
    expect(markStaleTemplatesMock).toHaveBeenCalledWith('tenant-1', [])
  })
})
