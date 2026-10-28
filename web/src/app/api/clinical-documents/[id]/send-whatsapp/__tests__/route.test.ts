import { describe, it, expect, vi, beforeEach } from 'vitest'
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
vi.mock('@/lib/whatsapp', () => ({ sendOrEnqueueDocument: vi.fn() }))
vi.mock('@/components/clinical-documents/print-document', () => ({ PrintDocument: () => null }))

import { requireWrite } from '@/lib/write-access'
import { getClinicalDocumentWithContext, updateDeliveryStatus } from '@/db/queries/clinical-documents'
import { renderReactToPdf } from '@/lib/pdf'
import { fetchLogoDataUri } from '@/lib/logo'
import { uploadPdfBuffer } from '@/lib/storage'
import { sendOrEnqueueDocument } from '@/lib/whatsapp'
import { POST } from '../route'

const DOC_ID = 'doc-1'

function post() {
  return POST(
    new NextRequest(`http://localhost/api/clinical-documents/${DOC_ID}/send-whatsapp`, { method: 'POST' }),
    { params: Promise.resolve({ id: DOC_ID }) },
  )
}

describe('POST /api/clinical-documents/[id]/send-whatsapp', () => {
  beforeEach(() => {
    vi.resetAllMocks()
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
  })

  it('records a queued document as pending', async () => {
    vi.mocked(sendOrEnqueueDocument).mockResolvedValue({ queued: true })

    const res = await post()

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({
      success: true,
      data: { deliveredVia: 'pending', whatsappMessageId: null, queued: true },
    })
    expect(updateDeliveryStatus).toHaveBeenCalledWith('tenant-1', DOC_ID, {
      deliveredVia: 'pending',
      whatsappMessageId: null,
      storagePath: 'documents/atestado.pdf',
    })
  })
})
