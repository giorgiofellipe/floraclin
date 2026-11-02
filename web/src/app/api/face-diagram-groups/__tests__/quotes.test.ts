import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createDiagramQuote: vi.fn(),
  deleteFile: vi.fn(),
  transaction: vi.fn(),
  getDiagramGroup: vi.fn(),
  listDiagramQuotes: vi.fn(),
  markQuoteWhatsapp: vi.fn(),
  claimQuoteWhatsapp: vi.fn(),
  releaseQuoteWhatsappClaim: vi.fn(),
  sendOrEnqueueDocument: vi.fn(),
  uploadPdfBuffer: vi.fn(),
}))

vi.mock('@/lib/tenant', () => ({ withTransaction: mocks.transaction }))
vi.mock('@/lib/write-access', () => ({
  requireWrite: vi.fn().mockResolvedValue({
    ctx: { tenantId: 't1', userId: 'u1', role: 'owner' },
    blocked: null,
  }),
}))
vi.mock('@/lib/auth', () => ({ getAuthContext: vi.fn().mockResolvedValue({ tenantId: 't1', userId: 'u1' }) }))
vi.mock('@/lib/audit', () => ({ createAuditLog: vi.fn() }))
vi.mock('@/db/queries/face-diagram-groups', () => ({ getDiagramGroup: mocks.getDiagramGroup }))
vi.mock('@/db/queries/face-diagram-quotes', () => ({
  createDiagramQuote: mocks.createDiagramQuote,
  listDiagramQuotes: mocks.listDiagramQuotes,
  getDiagramQuote: vi.fn().mockResolvedValue({
    id: 'q1', patientId: 'p1', storagePath: 'x/q1.pdf', whatsappStatus: null,
  }),
  markQuoteWhatsapp: mocks.markQuoteWhatsapp,
  claimQuoteWhatsapp: mocks.claimQuoteWhatsapp,
  releaseQuoteWhatsappClaim: mocks.releaseQuoteWhatsappClaim,
}))
vi.mock('@/db/queries/patients', () => ({
  getPatient: vi.fn().mockResolvedValue({ id: 'p1', fullName: 'Maria Silva', gender: 'female', phone: '11999998888' }),
}))
vi.mock('@/db/queries/tenants', () => ({
  getTenantHeaderInfoForPdf: vi.fn().mockResolvedValue(null),
  getTenant: vi.fn().mockResolvedValue({ name: 'Clinica Flora' }),
}))
vi.mock('@/lib/pdf', () => ({
  renderReactToPdf: vi.fn().mockResolvedValue(Buffer.from('pdf')),
  PRINT_BASE_CSS: '',
}))
vi.mock('@/lib/storage', () => ({
  getStoragePath: (tenantId: string, patientId: string, fileName: string) =>
    `${tenantId}/patients/${patientId}/${fileName}`,
  uploadPdfBuffer: mocks.uploadPdfBuffer,
  deleteFile: mocks.deleteFile,
  getSignedUrl: vi.fn().mockResolvedValue('https://signed'),
}))
vi.mock('@/lib/whatsapp', () => ({ sendOrEnqueueDocument: mocks.sendOrEnqueueDocument }))
vi.mock('@/lib/api-error', () => ({
  handleApiError: (e: unknown) => { throw e },
}))

import { GET, POST } from '../[id]/quotes/route'
import { POST as SEND } from '../../face-diagram-quotes/[id]/send-whatsapp/route'
import type { NextRequest } from 'next/server'

const line = { procedureTypeId: '11111111-1111-4111-8111-111111111111', procedureTypeName: 'Botox', sessions: 2, unitPrice: 100.5 }
const req = new Request('http://x') as unknown as NextRequest
const ctx = (id: string) => ({ params: Promise.resolve({ id }) })

function group(lines: (typeof line)[]) {
  return { id: 'g1', patientId: 'p1', quotationLines: lines, views: [] }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn({}))
  mocks.createDiagramQuote.mockResolvedValue({})
  mocks.deleteFile.mockResolvedValue(undefined)
  mocks.claimQuoteWhatsapp.mockResolvedValue(true)
  mocks.releaseQuoteWhatsappClaim.mockResolvedValue(undefined)
  mocks.uploadPdfBuffer.mockImplementation(async (a: { fileName: string }) => ({
    path: `t1/patients/p1/${a.fileName}`,
    url: 'https://signed',
  }))
})

describe('POST /api/face-diagram-groups/[id]/quotes', () => {
  it('rejects a group without quotation lines', async () => {
    mocks.getDiagramGroup.mockResolvedValue(group([]))
    const res = await POST(req, ctx('g1'))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Adicione ao menos um procedimento ao orçamento' })
    expect(mocks.createDiagramQuote).not.toHaveBeenCalled()
  })

  // Regression: later edits to the group must not rewrite a stored quote.
  it('stores the total and a copy of the lines', async () => {
    const g = group([{ ...line }]) as ReturnType<typeof group> & { quotationLines: (typeof line)[] }
    mocks.getDiagramGroup.mockResolvedValue(g)
    const res = await POST(req, ctx('g1'))
    expect(res.status).toBe(200)
    const input = mocks.createDiagramQuote.mock.calls[0][1]
    expect(input.total).toBe(201)
    expect(input.lines).toEqual([line])
    expect(input.lines).not.toBe(g.quotationLines)
    expect(input.lines[0]).not.toBe(g.quotationLines[0])
    g.quotationLines[0].unitPrice = 999
    expect(input.lines[0].unitPrice).toBe(100.5)
  })

  // Regression: a failed upload or insert must not leave an untracked patient PDF in storage.
  it.each([
    ['the insert fails', () => mocks.transaction.mockRejectedValue(new Error('boom'))],
    ['signing the uploaded file fails', () => mocks.uploadPdfBuffer.mockRejectedValue(new Error('boom'))],
  ])('deletes the uploaded file when %s', async (_name, fail) => {
    mocks.getDiagramGroup.mockResolvedValue(group([line]))
    fail()
    await expect(POST(req, ctx('g1'))).rejects.toThrow('boom')
    expect(mocks.deleteFile).toHaveBeenCalledTimes(1)
    expect(mocks.deleteFile.mock.calls[0][0]).toMatch(/^t1\/patients\/p1\/quotes\/.+\.pdf$/)
  })
})

describe('GET /api/face-diagram-groups/[id]/quotes', () => {
  // Regression: quotes of a deleted patient's group stayed listable by group id.
  it('returns 404 without listing when the group is not visible', async () => {
    mocks.getDiagramGroup.mockResolvedValue(null)
    const res = await GET(req, ctx('g1'))
    expect(res.status).toBe(404)
    expect(mocks.listDiagramQuotes).not.toHaveBeenCalled()
  })
})

describe('POST /api/face-diagram-quotes/[id]/send-whatsapp', () => {
  it('marks the quote queued when the sender queues it', async () => {
    mocks.sendOrEnqueueDocument.mockResolvedValue({ queued: true })
    const res = await SEND(req, ctx('q1'))
    expect(res.status).toBe(200)
    expect(mocks.markQuoteWhatsapp).toHaveBeenCalledWith('t1', 'q1', {
      status: 'queued',
      whatsappMessageId: null,
    })
  })

  // Regression: a double click sent the same quote to the patient twice.
  it('refuses with 409 without sending when the quote is already claimed', async () => {
    mocks.claimQuoteWhatsapp.mockResolvedValue(false)
    const res = await SEND(req, ctx('q1'))
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'Este orçamento já foi enviado' })
    expect(mocks.sendOrEnqueueDocument).not.toHaveBeenCalled()
  })

  it('releases the claim when the send fails so the user can retry', async () => {
    mocks.sendOrEnqueueDocument.mockRejectedValue(new Error('meta down'))
    await expect(SEND(req, ctx('q1'))).rejects.toThrow('meta down')
    expect(mocks.releaseQuoteWhatsappClaim).toHaveBeenCalledWith('t1', 'q1')
    expect(mocks.markQuoteWhatsapp).not.toHaveBeenCalled()
  })

  it('marks the quote sent when delivered directly', async () => {
    mocks.sendOrEnqueueDocument.mockResolvedValue({ sent: true, metaMessageId: 'wamid' })
    await SEND(req, ctx('q1'))
    expect(mocks.markQuoteWhatsapp).toHaveBeenCalledWith('t1', 'q1', {
      status: 'sent',
      whatsappMessageId: 'wamid',
    })
  })
})
