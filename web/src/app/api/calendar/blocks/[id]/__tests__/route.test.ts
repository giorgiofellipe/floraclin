import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/write-access', () => ({ requireWrite: vi.fn() }))
vi.mock('@/lib/audit', () => ({ createAuditLog: vi.fn() }))
vi.mock('@/db/queries/calendar', () => ({
  getBlockById: vi.fn(),
  deleteBlockById: vi.fn(),
}))

import { requireWrite } from '@/lib/write-access'
import { createAuditLog } from '@/lib/audit'
import { deleteBlockById, getBlockById } from '@/db/queries/calendar'
import { DELETE } from '../route'

const TENANT = 'tenant-1'
const OWNER_ID = 'owner-1'
const PRACTITIONER_ID = 'prac-1'

function as(role: 'owner' | 'practitioner', userId: string) {
  vi.mocked(requireWrite).mockResolvedValue({
    ctx: { tenantId: TENANT, userId, role },
    blocked: null,
  } as Awaited<ReturnType<typeof requireWrite>>)
}

function remove() {
  return DELETE(new Request('http://localhost/api/calendar/blocks/block-1', { method: 'DELETE' }), {
    params: Promise.resolve({ id: 'block-1' }),
  })
}

function block(overrides: Partial<{ practitionerId: string | null; source: 'google' | 'manual' }> = {}) {
  vi.mocked(getBlockById).mockResolvedValue({
    id: 'block-1',
    practitionerId: PRACTITIONER_ID,
    source: 'manual',
    title: null,
    date: '2026-10-12',
    startTime: null,
    endTime: null,
    allDay: true,
    ...overrides,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(deleteBlockById).mockResolvedValue({ id: 'b1' } as never)
})

describe('DELETE /api/calendar/blocks/[id]', () => {
  it('lets an owner delete a clinic-wide manual block and audits it', async () => {
    as('owner', OWNER_ID)
    block({ practitionerId: null })

    const res = await remove()

    expect(res.status).toBe(200)
    expect(deleteBlockById).toHaveBeenCalledWith(TENANT, 'block-1')
    expect(createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ entityType: 'calendar_block', entityId: 'block-1', action: 'delete' }),
    )
  })

  it('lets a practitioner delete their own manual block', async () => {
    as('practitioner', PRACTITIONER_ID)
    block()

    const res = await remove()

    expect(res.status).toBe(200)
    expect(deleteBlockById).toHaveBeenCalled()
  })

  it.each([
    ['another practitioner', 'prac-2'],
    ['the whole clinic', null],
  ])('refuses a practitioner deleting a block of %s', async (_label, practitionerId) => {
    as('practitioner', PRACTITIONER_ID)
    block({ practitionerId })

    const res = await remove()

    expect(res.status).toBe(403)
    expect(deleteBlockById).not.toHaveBeenCalled()
  })

  it('answers 409 for a Google-synced block, which would come back on the next sync', async () => {
    as('owner', OWNER_ID)
    block({ source: 'google' })

    const res = await remove()

    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('Bloqueio sincronizado do Google Agenda. Remova o evento no Google.')
    expect(deleteBlockById).not.toHaveBeenCalled()
  })

  it('answers 404 for an unknown id', async () => {
    as('owner', OWNER_ID)
    vi.mocked(getBlockById).mockResolvedValue(null as never)

    const res = await remove()

    expect(res.status).toBe(404)
    expect((await res.json()).error).toBe('Bloqueio não encontrado')
    expect(deleteBlockById).not.toHaveBeenCalled()
  })

  it('answers 404 without an audit row when another request deleted the block first', async () => {
    as('owner', OWNER_ID)
    block()
    vi.mocked(deleteBlockById).mockResolvedValue(null as never)

    const res = await remove()

    expect(res.status).toBe(404)
    expect(createAuditLog).not.toHaveBeenCalled()
  })
})
