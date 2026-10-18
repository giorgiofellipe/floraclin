import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextResponse } from 'next/server'

vi.mock('@/lib/auth', () => ({ getAuthContext: vi.fn() }))
vi.mock('@/lib/write-access', () => ({ requireWrite: vi.fn() }))
vi.mock('@/db/queries/card-terminals', () => ({
  listCardTerminals: vi.fn(),
  createCardTerminal: vi.fn(),
  updateCardTerminal: vi.fn(),
  deleteCardTerminal: vi.fn(),
}))

import { requireWrite } from '@/lib/write-access'
import { BusinessError } from '@/lib/errors'
import { createCardTerminal, updateCardTerminal } from '@/db/queries/card-terminals'
import { POST } from '../route'
import { PATCH } from '../[id]/route'

const validBody = {
  name: 'Stone',
  isDefault: true,
  debitRate: 1.5,
  debitPayoutDays: 1,
  creditRates: Array.from({ length: 12 }, () => 3),
  creditPayoutMode: 'per_installment',
  creditLumpSumDays: 1,
}

function post(body: unknown) {
  return new Request('http://test/api/financial/card-terminals', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireWrite).mockResolvedValue({
    ctx: { tenantId: 't1', userId: 'u1', role: 'owner' },
    blocked: null,
  } as never)
})

describe('POST /api/financial/card-terminals', () => {
  it('returns 400 when creditRates has 11 entries', async () => {
    const res = await POST(post({ ...validBody, creditRates: validBody.creditRates.slice(0, 11) }))

    expect(res.status).toBe(400)
    expect(createCardTerminal).not.toHaveBeenCalled()
  })

  it('returns the blocked response without writing when requireWrite refuses', async () => {
    vi.mocked(requireWrite).mockResolvedValue({
      ctx: null,
      blocked: NextResponse.json({ error: 'Sem permissão' }, { status: 403 }),
    } as never)

    const res = await POST(post(validBody))

    expect(res.status).toBe(403)
    expect(createCardTerminal).not.toHaveBeenCalled()
  })

  it('creates with the session tenant', async () => {
    vi.mocked(createCardTerminal).mockResolvedValue({ id: 'c1' } as never)

    const res = await POST(post(validBody))

    expect(res.status).toBe(200)
    expect(createCardTerminal).toHaveBeenCalledWith('t1', 'u1', validBody)
  })
})

describe('PATCH /api/financial/card-terminals/[id]', () => {
  it('maps a missing terminal to 404', async () => {
    vi.mocked(updateCardTerminal).mockRejectedValue(new BusinessError('CARD_TERMINAL_NOT_FOUND', 'Maquininha não encontrada'))

    const res = await PATCH(post(validBody), { params: Promise.resolve({ id: 'c1' }) })

    expect(res.status).toBe(404)
  })
})
