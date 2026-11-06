// @vitest-environment node
// Multipart uploads need Node's own Request/FormData/File; jsdom's FormData is not one Request can send.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextResponse } from 'next/server'

vi.mock('@/lib/auth', () => ({ requireRole: vi.fn() }))
vi.mock('@/lib/write-access', () => ({ requireWrite: vi.fn() }))
vi.mock('@/db/queries/bank-reconciliation', () => ({
  commitStatementImport: vi.fn(),
  previewStatementImport: vi.fn(),
  listStatementImports: vi.fn(),
  listStatementLines: vi.fn(),
  findMatchCandidates: vi.fn(),
  allocateStatementLine: vi.fn(),
  undoStatementLineMatch: vi.fn(),
  ignoreStatementLine: vi.fn(),
  unignoreStatementLine: vi.fn(),
  confirmSuspectedLineIsDistinct: vi.fn(),
  createExpenseFromStatementLine: vi.fn(),
}))

import { requireRole } from '@/lib/auth'
import { requireWrite } from '@/lib/write-access'
import { BusinessError, ForbiddenError } from '@/lib/errors'
import {
  allocateStatementLine,
  commitStatementImport,
  createExpenseFromStatementLine,
  findMatchCandidates,
  ignoreStatementLine,
  listStatementLines,
  previewStatementImport,
  undoStatementLineMatch,
} from '@/db/queries/bank-reconciliation'
import { GET as getLines } from '../lines/route'
import { GET as getCandidates } from '../lines/[id]/candidates/route'
import { POST as postAllocations, DELETE as deleteAllocations } from '../lines/[id]/allocations/route'
import { POST as postIgnore } from '../lines/[id]/ignore/route'
import { POST as postExpense } from '../lines/[id]/expense/route'
import { POST as postImport } from '../imports/route'
import { POST as postPreview } from '../imports/preview/route'

const ACCOUNT = '11111111-1111-4111-8111-11111111111a'
const MOVEMENT = '22222222-2222-4222-8222-22222222222b'
const LINE = '33333333-3333-4333-8333-33333333333c'
const CTX = { tenantId: 'tenant-from-session', userId: 'u1', role: 'owner' }
const params = { params: Promise.resolve({ id: LINE }) }

const json = (body: unknown) =>
  new Request('http://test/api', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })

function upload(content: string | Uint8Array, accountId: string = ACCOUNT) {
  const form = new FormData()
  form.set('accountId', accountId)
  form.set('file', new File([content as BlobPart], 'extrato.ofx'))
  return new Request('http://test/api', { method: 'POST', body: form })
}

const OFX = '<OFX><STMTRS><CURDEF>BRL<BANKTRANLIST><STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20261001<TRNAMT>10.00<FITID>1<MEMO>X</STMTTRN></BANKTRANLIST></STMTRS></OFX>'

beforeEach(() => {
  vi.clearAllMocks()
  // The real requireRole checks the caller's role against the allowed list.
  vi.mocked(requireRole).mockImplementation((async (...roles: string[]) => {
    if (!roles.includes(CTX.role)) throw new ForbiddenError('Forbidden: insufficient permissions')
    return CTX
  }) as never)
  vi.mocked(requireWrite).mockResolvedValue({ ctx: CTX, blocked: null } as never)
})

describe('who can reconcile', () => {
  it.each(['receptionist', 'professional', 'dentist'])('denies reading statement lines to %s without touching the data', async (role) => {
    CTX.role = role
    const res = await getLines(new Request(`http://test/api?accountId=${ACCOUNT}`))
    CTX.role = 'owner'

    expect(res.status).toBe(403)
    expect(listStatementLines).not.toHaveBeenCalled()
  })

  it.each(['owner', 'financial'])('lets %s read, scoped to the session tenant and never one from the request', async (role) => {
    CTX.role = role
    vi.mocked(listStatementLines).mockResolvedValue({ lines: [], hasMore: false })
    const res = await getLines(new Request(`http://test/api?accountId=${ACCOUNT}&status=open&tenantId=evil`))
    CTX.role = 'owner'

    expect(res.status).toBe(200)
    expect(listStatementLines).toHaveBeenCalledWith('tenant-from-session', { accountId: ACCOUNT, status: 'open', offset: 0 })
  })

  it('asks for the owner and Financeiro roles on writes, and passes the subscription block through', async () => {
    vi.mocked(requireWrite).mockResolvedValue({
      ctx: null,
      blocked: NextResponse.json({ error: 'Plano expirado' }, { status: 402 }),
    } as never)

    const res = await postAllocations(json({ allocations: [{ movementId: MOVEMENT, amountCents: 100 }] }), params)

    expect(res.status).toBe(402)
    expect(vi.mocked(requireWrite).mock.calls[0]).toEqual(['owner', 'financial'])
    expect(allocateStatementLine).not.toHaveBeenCalled()
  })
})

describe('reading', () => {
  it('rejects a missing or malformed account', async () => {
    const res = await getLines(new Request('http://test/api?accountId=nope'))
    expect(res.status).toBe(400)
    expect(listStatementLines).not.toHaveBeenCalled()
  })

  it('searches candidates for the session tenant', async () => {
    vi.mocked(findMatchCandidates).mockResolvedValue([])
    const res = await getCandidates(new Request('http://test/api?search=pix'), params)

    expect(res.status).toBe(200)
    expect(findMatchCandidates).toHaveBeenCalledWith('tenant-from-session', LINE, { search: 'pix' })
  })

  it('maps a missing line to a conflict response with the code', async () => {
    vi.mocked(findMatchCandidates).mockRejectedValue(new BusinessError('STATEMENT_LINE_NOT_FOUND', 'Lançamento do extrato não encontrado'))
    const res = await getCandidates(new Request('http://test/api'), params)

    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: 'STATEMENT_LINE_NOT_FOUND' })
  })
})

describe('allocations', () => {
  it('passes whole-cent allocations with the session user', async () => {
    vi.mocked(allocateStatementLine).mockResolvedValue({ allocationIds: ['a1'] })
    const res = await postAllocations(json({ allocations: [{ movementId: MOVEMENT, amountCents: 12345 }] }), params)

    expect(res.status).toBe(200)
    expect(allocateStatementLine).toHaveBeenCalledWith('tenant-from-session', 'u1', LINE, [{ movementId: MOVEMENT, amountCents: 12345 }])
  })

  it.each([
    ['fractional cents', { allocations: [{ movementId: MOVEMENT, amountCents: 10.5 }] }],
    ['zero', { allocations: [{ movementId: MOVEMENT, amountCents: 0 }] }],
    ['empty list', { allocations: [] }],
    ['bad movement id', { allocations: [{ movementId: 'x', amountCents: 100 }] }],
  ])('rejects %s with 400 before touching the data', async (_name, body) => {
    const res = await postAllocations(json(body), params)

    expect(res.status).toBe(400)
    expect(allocateStatementLine).not.toHaveBeenCalled()
  })

  it('surfaces an over-allocation as a conflict', async () => {
    vi.mocked(allocateStatementLine).mockRejectedValue(new BusinessError('ALLOCATION_OVER_LINE', 'O total é maior'))
    const res = await postAllocations(json({ allocations: [{ movementId: MOVEMENT, amountCents: 100 }] }), params)

    expect(res.status).toBe(409)
  })

  it('undoes all allocations of a line, or just the one asked', async () => {
    vi.mocked(undoStatementLineMatch).mockResolvedValue({ undone: 1 })
    await deleteAllocations(new Request('http://test/api', { method: 'DELETE' }), params)
    expect(undoStatementLineMatch).toHaveBeenLastCalledWith('tenant-from-session', 'u1', { lineId: LINE, allocationId: undefined })

    await deleteAllocations(new Request(`http://test/api?allocationId=${MOVEMENT}`, { method: 'DELETE' }), params)
    expect(undoStatementLineMatch).toHaveBeenLastCalledWith('tenant-from-session', 'u1', { lineId: LINE, allocationId: MOVEMENT })
  })
})

describe('ignore and expense from a line', () => {
  it('needs a reason to ignore', async () => {
    const res = await postIgnore(json({ reason: '   ' }), params)
    expect(res.status).toBe(400)
    expect(ignoreStatementLine).not.toHaveBeenCalled()
  })

  it('creates the expense with the category and method chosen', async () => {
    vi.mocked(createExpenseFromStatementLine).mockResolvedValue({ expenseId: 'e', movementId: 'm', allocationId: 'a', reused: false })
    const category = '44444444-4444-4444-8444-44444444444d'
    const res = await postExpense(json({ categoryId: category }), params)

    expect(res.status).toBe(200)
    expect(createExpenseFromStatementLine).toHaveBeenCalledWith('tenant-from-session', 'u1', LINE, { categoryId: category, paymentMethod: 'transfer' })
  })

  it('refuses an unknown payment method', async () => {
    const res = await postExpense(json({ categoryId: '44444444-4444-4444-8444-44444444444d', paymentMethod: 'barter' }), params)
    expect(res.status).toBe(400)
    expect(createExpenseFromStatementLine).not.toHaveBeenCalled()
  })
})

describe('uploads', () => {
  it('previews and commits with the session tenant', async () => {
    vi.mocked(previewStatementImport).mockResolvedValue({ total: 1 } as never)
    vi.mocked(commitStatementImport).mockResolvedValue({ importId: 'i' } as never)

    expect((await postPreview(upload(OFX))).status).toBe(200)
    expect(previewStatementImport).toHaveBeenCalledWith('tenant-from-session', ACCOUNT, expect.objectContaining({ transactions: expect.any(Array) }))

    expect((await postImport(upload(OFX))).status).toBe(200)
    expect(commitStatementImport).toHaveBeenCalledWith('tenant-from-session', 'u1', expect.objectContaining({ accountId: ACCOUNT, fileName: 'extrato.ofx' }))
  })

  it('refuses a file over the size limit before parsing it', async () => {
    const res = await postImport(upload(new Uint8Array(2 * 1024 * 1024 + 1)))

    expect(res.status).toBe(422)
    expect(commitStatementImport).not.toHaveBeenCalled()
  })

  it('refuses a request without a file or with a bad account', async () => {
    const noFile = new FormData()
    noFile.set('accountId', ACCOUNT)
    expect((await postImport(new Request('http://test/api', { method: 'POST', body: noFile }))).status).toBe(400)
    expect((await postImport(upload(OFX, 'nope'))).status).toBe(400)
    expect(commitStatementImport).not.toHaveBeenCalled()
  })

  it('passes a malformed statement to the importer, which refuses it with 422', async () => {
    vi.mocked(commitStatementImport).mockRejectedValue(new BusinessError('STATEMENT_INVALID', '1 lançamento(s) inválido(s)'))
    const res = await postImport(upload(OFX.replace('10.00', 'abc')))

    expect(res.status).toBe(422)
  })
})
