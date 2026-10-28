import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth-config', () => ({ auth: vi.fn() }))
vi.mock('@/db/client', () => ({ db: { select: vi.fn() } }))
vi.mock('@/db/queries/consent', () => ({ getConsentAcceptanceWithContext: vi.fn() }))
vi.mock('@/db/queries/consent-signing-tokens', () => ({
  getRecentlyUsedSigningToken: vi.fn(),
  claimPatientCopy: vi.fn(),
  releasePatientCopy: vi.fn(),
}))
vi.mock('@/lib/plans', () => ({ isSubscriptionActive: vi.fn(), requireActiveSubscription: vi.fn() }))
vi.mock('@/lib/pdf', () => ({ renderReactToPdf: vi.fn(), PRINT_BASE_CSS: '' }))
vi.mock('@/lib/logo', () => ({ fetchLogoDataUri: vi.fn() }))
vi.mock('@/lib/storage', () => ({ uploadPdfBuffer: vi.fn() }))
// Mocked by default; the no-conversation cases below run the real one.
vi.mock('@/lib/whatsapp', () => ({ sendOrEnqueueDocument: vi.fn() }))
vi.mock('@/db/queries/tenants', () => ({ getTenant: vi.fn() }))
vi.mock('@/db/queries/whatsapp', () => ({
  getConversationByPhone: vi.fn(),
  getQueuedCount: vi.fn(),
  createQueuedMessage: vi.fn(),
  createMessage: vi.fn(),
  upsertConversation: vi.fn(),
  getSendableTemplate: vi.fn(),
  getTemplateByPurpose: vi.fn(),
}))
vi.mock('@/db/queries/whatsapp-credits', () => ({
  spendCredits: vi.fn(),
  attachMetaMessageId: vi.fn(),
  refundSpend: vi.fn(),
  getOrCreateCurrentPeriod: vi.fn(),
}))
vi.mock('@/components/consent/print-consent', () => ({ PrintConsent: () => null }))

import { auth } from '@/lib/auth-config'
import { db } from '@/db/client'
import { getConsentAcceptanceWithContext } from '@/db/queries/consent'
import { getRecentlyUsedSigningToken, claimPatientCopy, releasePatientCopy } from '@/db/queries/consent-signing-tokens'
import { isSubscriptionActive } from '@/lib/plans'
import { renderReactToPdf } from '@/lib/pdf'
import { fetchLogoDataUri } from '@/lib/logo'
import { uploadPdfBuffer } from '@/lib/storage'
import { sendOrEnqueueDocument } from '@/lib/whatsapp'
import { getTenant } from '@/db/queries/tenants'
import { getConversationByPhone, createQueuedMessage, upsertConversation, getSendableTemplate } from '@/db/queries/whatsapp'
import { spendCredits, attachMetaMessageId, getOrCreateCurrentPeriod } from '@/db/queries/whatsapp-credits'
import { RESUME_TEMPLATE, mockSystemTemplateRows } from '@/tests/mocks/whatsapp-templates'
import { POST } from '../route'

const ACCEPTANCE_ID = 'acc-1'

function mockMembershipRow(row: { tenantId: string; passwordChangedAt?: Date | null } | undefined) {
  const chain: Record<string, unknown> = {}
  for (const m of ['from', 'innerJoin', 'where']) chain[m] = vi.fn(() => chain)
  chain.limit = vi.fn(async () => (row ? [{ passwordChangedAt: null, ...row }] : []))
  vi.mocked(db.select).mockReturnValue(chain as never)
}

function post(query = '') {
  return POST(
    new NextRequest(`http://localhost/api/consent/${ACCEPTANCE_ID}/send-whatsapp${query}`, {
      method: 'POST',
    }),
    { params: Promise.resolve({ id: ACCEPTANCE_ID }) },
  )
}

describe('POST /api/consent/[id]/send-whatsapp', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(isSubscriptionActive).mockResolvedValue(true)
    vi.mocked(getConsentAcceptanceWithContext).mockResolvedValue({
      patientId: 'patient-1',
      patientName: 'Maria Silva',
      patientPhone: '11999990000',
      templateTitle: 'Termo de Botox',
      tenantLogoUrl: null,
    } as never)
    vi.mocked(fetchLogoDataUri).mockResolvedValue(null as never)
    vi.mocked(renderReactToPdf).mockResolvedValue(new Uint8Array([1]) as never)
    vi.mocked(uploadPdfBuffer).mockResolvedValue({ url: 'https://x/y.pdf', path: 'termos/y.pdf' } as never)
    vi.mocked(sendOrEnqueueDocument).mockResolvedValue({} as never)
  })

  it('attributes the send to the session user', async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: 'user-1' } } as never)
    mockMembershipRow({ tenantId: 'tenant-1' })

    const res = await post()

    expect(res.status).toBe(200)
    expect(sendOrEnqueueDocument).toHaveBeenCalledWith(
      'tenant-1',
      {
        actor: { type: 'user', userId: 'user-1' },
        recipient: { patientId: 'patient-1', name: 'Maria Silva' },
        documentLabel: 'Termo de Botox',
      },
      expect.any(String),
      'Maria',
      'https://x/y.pdf',
      expect.any(String),
      expect.any(String),
      'termos/y.pdf',
    )
  })

  it('attributes a signing-token send without a session to the patient', async () => {
    vi.mocked(auth).mockResolvedValue(null as never)
    vi.mocked(getRecentlyUsedSigningToken).mockResolvedValue({ id: 'token-1', tenantId: 'tenant-1' } as never)
    vi.mocked(claimPatientCopy).mockResolvedValue({ tenantId: 'tenant-1', alreadySent: false })

    const res = await post('?token=abc')

    expect(res.status).toBe(200)
    expect(sendOrEnqueueDocument).toHaveBeenCalledWith(
      'tenant-1',
      {
        actor: { type: 'patient' },
        recipient: { patientId: 'patient-1', name: 'Maria Silva' },
        documentLabel: 'Termo de Botox',
      },
      expect.any(String),
      'Maria',
      'https://x/y.pdf',
      expect.any(String),
      expect.any(String),
      'termos/y.pdf',
    )
  })

  it('refuses a token send for an acceptance the token did not sign', async () => {
    vi.mocked(auth).mockResolvedValue(null as never)
    vi.mocked(getRecentlyUsedSigningToken).mockResolvedValue({ id: 'token-1', tenantId: 'tenant-1' } as never)
    vi.mocked(claimPatientCopy).mockResolvedValue(null)

    const res = await post('?token=abc')

    expect(res.status).toBe(401)
    expect(claimPatientCopy).toHaveBeenCalledWith(ACCEPTANCE_ID, 'token-1')
    expect(renderReactToPdf).not.toHaveBeenCalled()
    expect(sendOrEnqueueDocument).not.toHaveBeenCalled()
  })

  it('answers success without sending again when the copy was already sent', async () => {
    vi.mocked(auth).mockResolvedValue(null as never)
    vi.mocked(getRecentlyUsedSigningToken).mockResolvedValue({ id: 'token-1', tenantId: 'tenant-1' } as never)
    vi.mocked(claimPatientCopy).mockResolvedValue({ tenantId: 'tenant-1', alreadySent: true })

    const res = await post('?token=abc')

    expect(res.status).toBe(200)
    expect(sendOrEnqueueDocument).not.toHaveBeenCalled()
    expect(releasePatientCopy).not.toHaveBeenCalled()
  })

  it('gives the claimed copy back when the send fails, so the patient can retry', async () => {
    vi.mocked(auth).mockResolvedValue(null as never)
    vi.mocked(getRecentlyUsedSigningToken).mockResolvedValue({ id: 'token-1', tenantId: 'tenant-1' } as never)
    vi.mocked(claimPatientCopy).mockResolvedValue({ tenantId: 'tenant-1', alreadySent: false })
    vi.mocked(sendOrEnqueueDocument).mockRejectedValue(new Error('meta down'))
    vi.mocked(releasePatientCopy).mockResolvedValue(undefined)

    const res = await post('?token=abc')

    expect(res.status).toBe(500)
    expect(releasePatientCopy).toHaveBeenCalledWith(ACCEPTANCE_ID)
  })

  it('still answers the send failure when giving the copy back fails too', async () => {
    vi.mocked(auth).mockResolvedValue(null as never)
    vi.mocked(getRecentlyUsedSigningToken).mockResolvedValue({ id: 'token-1', tenantId: 'tenant-1' } as never)
    vi.mocked(claimPatientCopy).mockResolvedValue({ tenantId: 'tenant-1', alreadySent: false })
    vi.mocked(sendOrEnqueueDocument).mockRejectedValue(new Error('meta down'))
    vi.mocked(releasePatientCopy).mockRejectedValue(new Error('db down'))

    const res = await post('?token=abc')

    expect(res.status).toBe(500)
  })

  it('refuses a session from before the last password change', async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: 'user-1' }, authAt: Date.parse('2026-10-01') } as never)
    mockMembershipRow({ tenantId: 'tenant-1', passwordChangedAt: new Date('2026-10-02') })

    const res = await post()

    expect(res.status).toBe(401)
    expect(sendOrEnqueueDocument).not.toHaveBeenCalled()
  })
})

describe('POST /api/consent/[id]/send-whatsapp — patient with no conversation', () => {
  const originalFetch = global.fetch

  // The token path never reads `db` itself, so the only select left is the
  // system-template lookup on the shared number.
  beforeEach(async () => {
    vi.resetAllMocks()
    const actual = await vi.importActual<typeof import('@/lib/whatsapp')>('@/lib/whatsapp')
    vi.mocked(sendOrEnqueueDocument).mockImplementation(actual.sendOrEnqueueDocument)

    vi.stubEnv('FLORACLIN_WA_PHONE_NUMBER_ID', 'fc-phone')
    vi.stubEnv('FLORACLIN_WA_ACCESS_TOKEN', 'fc-token')
    vi.stubEnv('FLORACLIN_WA_BUSINESS_ACCOUNT_ID', 'fc-biz')
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ messages: [{ id: 'wamid.resume' }] }), { status: 200 }),
    ) as unknown as typeof fetch

    vi.mocked(auth).mockResolvedValue(null as never)
    vi.mocked(getRecentlyUsedSigningToken).mockResolvedValue({ id: 'token-1', tenantId: 'tenant-1' } as never)
    vi.mocked(claimPatientCopy).mockResolvedValue({ tenantId: 'tenant-1', alreadySent: false })
    vi.mocked(releasePatientCopy).mockResolvedValue(undefined)
    vi.mocked(isSubscriptionActive).mockResolvedValue(true)
    vi.mocked(getConsentAcceptanceWithContext).mockResolvedValue({
      patientId: 'patient-1',
      patientName: 'Maria Silva',
      patientPhone: '11999990000',
      templateTitle: 'Termo de Botox',
      tenantLogoUrl: null,
    } as never)
    vi.mocked(fetchLogoDataUri).mockResolvedValue(null as never)
    vi.mocked(renderReactToPdf).mockResolvedValue(new Uint8Array([1]) as never)
    vi.mocked(uploadPdfBuffer).mockResolvedValue({ url: 'https://x/y.pdf', path: 'termos/y.pdf' } as never)

    vi.mocked(getTenant).mockResolvedValue({ id: 'tenant-1', settings: { whatsapp_mode: 'floraclin' } } as never)
    vi.mocked(getConversationByPhone).mockResolvedValue(null)
    vi.mocked(upsertConversation).mockResolvedValue({ id: 'conv-new', lastInboundAt: null } as never)
    vi.mocked(getSendableTemplate).mockResolvedValue(RESUME_TEMPLATE as never)
    vi.mocked(getOrCreateCurrentPeriod).mockResolvedValue({ creditsUsed: 0, creditsTotal: 300 } as never)
    vi.mocked(spendCredits).mockResolvedValue({ allowed: true, spendId: 'spend-1', creditsUsed: 1, creditsTotal: 300 } as never)
    vi.mocked(attachMetaMessageId).mockResolvedValue(undefined as never)
  })

  afterEach(() => {
    global.fetch = originalFetch
    vi.unstubAllEnvs()
  })

  it('queues the patient copy in a new conversation and keeps the copy claimed', async () => {
    mockSystemTemplateRows([RESUME_TEMPLATE])

    const res = await post('?token=abc')

    expect(res.status).toBe(200)
    expect(upsertConversation).toHaveBeenCalledWith('tenant-1', '5511999990000', 'Maria Silva', undefined, 'patient-1')
    expect(createQueuedMessage).toHaveBeenCalledWith('tenant-1', 'conv-new', expect.objectContaining({
      mediaType: 'document',
      mediaUrl: 'https://x/y.pdf',
      resumeMetaMessageId: 'wamid.resume',
    }))
    expect(releasePatientCopy).not.toHaveBeenCalled()
  })

  it('refuses the send without charging and gives the copy back when the resume template is unavailable', async () => {
    mockSystemTemplateRows([])

    const res = await post('?token=abc')

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({ error: 'Template de WhatsApp não encontrado.' })
    expect(spendCredits).not.toHaveBeenCalled()
    expect(upsertConversation).not.toHaveBeenCalled()
    expect(createQueuedMessage).not.toHaveBeenCalled()
    expect(releasePatientCopy).toHaveBeenCalledWith(ACCEPTANCE_ID)
  })
})
