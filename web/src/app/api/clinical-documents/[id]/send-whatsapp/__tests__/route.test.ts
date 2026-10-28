/**
 * Runs the real `sendOrEnqueueDocument` against mocked queries and a mocked
 * Meta API, so what is checked is how the route reports a send to a patient
 * who has never talked to the clinic on WhatsApp: queued behind the resume
 * template, or refused when that template can't go out.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/write-access', () => ({ requireWrite: vi.fn() }))
vi.mock('@/lib/audit', () => ({ createAuditLog: vi.fn() }))
vi.mock('@/db/queries/clinical-documents', () => ({
  getClinicalDocumentWithContext: vi.fn(),
  updateDeliveryStatus: vi.fn(),
}))
vi.mock('@/lib/pdf', () => ({ renderReactToPdf: vi.fn(), PRINT_BASE_CSS: '' }))
vi.mock('@/lib/logo', () => ({ fetchLogoDataUri: vi.fn() }))
vi.mock('@/lib/storage', () => ({ uploadPdfBuffer: vi.fn() }))
vi.mock('@/components/clinical-documents/print-document', () => ({ PrintDocument: () => null }))
vi.mock('@/lib/plans', () => ({ requireActiveSubscription: vi.fn() }))
vi.mock('@/db/queries/tenants', () => ({ getTenant: vi.fn() }))
vi.mock('@/db/client', () => ({ db: { select: vi.fn() } }))
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

import { requireWrite } from '@/lib/write-access'
import { getClinicalDocumentWithContext, updateDeliveryStatus } from '@/db/queries/clinical-documents'
import { renderReactToPdf } from '@/lib/pdf'
import { fetchLogoDataUri } from '@/lib/logo'
import { uploadPdfBuffer } from '@/lib/storage'
import { getTenant } from '@/db/queries/tenants'
import {
  getConversationByPhone,
  createQueuedMessage,
  upsertConversation,
  getSendableTemplate,
} from '@/db/queries/whatsapp'
import { spendCredits, attachMetaMessageId, getOrCreateCurrentPeriod } from '@/db/queries/whatsapp-credits'
import { RESUME_TEMPLATE, mockSystemTemplateRows } from '@/tests/mocks/whatsapp-templates'
import { POST } from '../route'

const DOC_ID = 'doc-1'

function post() {
  return POST(
    new NextRequest(`http://localhost/api/clinical-documents/${DOC_ID}/send-whatsapp`, { method: 'POST' }),
    { params: Promise.resolve({ id: DOC_ID }) },
  )
}

describe('POST /api/clinical-documents/[id]/send-whatsapp — patient with no conversation', () => {
  const originalFetch = global.fetch

  beforeEach(() => {
    vi.resetAllMocks()
    vi.stubEnv('FLORACLIN_WA_PHONE_NUMBER_ID', 'fc-phone')
    vi.stubEnv('FLORACLIN_WA_ACCESS_TOKEN', 'fc-token')
    vi.stubEnv('FLORACLIN_WA_BUSINESS_ACCOUNT_ID', 'fc-biz')
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ messages: [{ id: 'wamid.resume' }] }), { status: 200 }),
    ) as unknown as typeof fetch

    vi.mocked(requireWrite).mockResolvedValue({ ctx: { tenantId: 'tenant-1', userId: 'user-1' }, blocked: null } as never)
    vi.mocked(getClinicalDocumentWithContext).mockResolvedValue({
      id: DOC_ID,
      kind: 'atestado',
      title: 'Atestado',
      patientId: 'patient-1',
      deliveredVia: null,
      patient: { fullName: 'Maria Silva', phone: '11999990000' },
      tenant: { logoUrl: null },
    } as never)
    vi.mocked(fetchLogoDataUri).mockResolvedValue(null as never)
    vi.mocked(renderReactToPdf).mockResolvedValue(new Uint8Array([1]) as never)
    vi.mocked(uploadPdfBuffer).mockResolvedValue({ url: 'https://x/atestado.pdf', path: 'documents/atestado.pdf' } as never)

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

  it('records the document as pending and queues it in a new conversation', async () => {
    mockSystemTemplateRows([RESUME_TEMPLATE])

    const res = await post()

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({
      success: true,
      data: { deliveredVia: 'pending', whatsappMessageId: null, queued: true },
    })
    expect(upsertConversation).toHaveBeenCalledWith('tenant-1', '5511999990000', 'Maria Silva', undefined, 'patient-1')
    expect(createQueuedMessage).toHaveBeenCalledWith('tenant-1', 'conv-new', expect.objectContaining({
      mediaType: 'document',
      mediaUrl: 'https://x/atestado.pdf',
      resumeMetaMessageId: 'wamid.resume',
    }))
    expect(updateDeliveryStatus).toHaveBeenCalledWith('tenant-1', DOC_ID, {
      deliveredVia: 'pending',
      whatsappMessageId: null,
      storagePath: 'documents/atestado.pdf',
    })
  })

  it('refuses the send without charging or recording a delivery when the resume template is unavailable', async () => {
    mockSystemTemplateRows([])

    const res = await post()

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({ error: 'Template de WhatsApp não encontrado.' })
    expect(spendCredits).not.toHaveBeenCalled()
    expect(upsertConversation).not.toHaveBeenCalled()
    expect(createQueuedMessage).not.toHaveBeenCalled()
    expect(updateDeliveryStatus).not.toHaveBeenCalled()
  })
})
