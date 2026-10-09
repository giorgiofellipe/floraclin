import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/write-access', () => ({ requireWrite: vi.fn() }))
vi.mock('@/lib/audit', () => ({ createAuditLog: vi.fn() }))
vi.mock('@/lib/auth', () => ({ getAuthContext: vi.fn() }))
vi.mock('@/db/queries/calendar', () => ({
  createManualBlock: vi.fn(),
  listBlocksForDateRange: vi.fn(),
}))

import { NextResponse } from 'next/server'
import { requireWrite } from '@/lib/write-access'
import { createAuditLog } from '@/lib/audit'
import { createManualBlock } from '@/db/queries/calendar'
import { BusinessError } from '@/lib/errors'
import { POST } from '../route'

const TENANT = 'tenant-1'
const OWNER_ID = '11111111-1111-4111-8111-111111111111'
const PRACTITIONER_ID = '22222222-2222-4222-8222-222222222222'
const OTHER_ID = '33333333-3333-4333-8333-333333333333'

function as(role: 'owner' | 'practitioner', userId: string) {
  vi.mocked(requireWrite).mockResolvedValue({
    ctx: { tenantId: TENANT, userId, role },
    blocked: null,
  } as Awaited<ReturnType<typeof requireWrite>>)
}

function post(body: unknown) {
  return POST(
    new Request('http://localhost/api/calendar/blocks', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  )
}

const clinicWide = { practitionerId: null, date: '2026-10-20', allDay: true }

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(createManualBlock).mockResolvedValue({ id: 'block-1' })
})

describe('POST /api/calendar/blocks', () => {
  it('lets an owner block the whole clinic for a day and audits it', async () => {
    as('owner', OWNER_ID)

    const res = await post({ ...clinicWide, title: 'Feriado' })

    expect(res.status).toBe(201)
    expect(createManualBlock).toHaveBeenCalledWith(TENANT, {
      practitionerId: null,
      title: 'Feriado',
      date: '2026-10-20',
      startTime: null,
      endTime: null,
      allDay: true,
    })
    expect(createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ entityType: 'calendar_block', entityId: 'block-1', action: 'create' }),
    )
  })

  it('lets a practitioner block their own agenda', async () => {
    as('practitioner', PRACTITIONER_ID)

    const res = await post({
      practitionerId: PRACTITIONER_ID,
      date: '2026-10-20',
      allDay: false,
      startTime: '09:00',
      endTime: '10:00',
    })

    expect(res.status).toBe(201)
    expect(createManualBlock).toHaveBeenCalledWith(
      TENANT,
      expect.objectContaining({ practitionerId: PRACTITIONER_ID, startTime: '09:00', endTime: '10:00', allDay: false }),
    )
  })

  it.each([
    ['another practitioner', OTHER_ID],
    ['the whole clinic', null],
  ])('refuses a practitioner blocking %s', async (_label, practitionerId) => {
    as('practitioner', PRACTITIONER_ID)

    const res = await post({ ...clinicWide, practitionerId })

    expect(res.status).toBe(403)
    expect(createManualBlock).not.toHaveBeenCalled()
    expect(createAuditLog).not.toHaveBeenCalled()
  })

  it('answers 404 with the message when the practitioner is not in the tenant', async () => {
    as('owner', OWNER_ID)
    vi.mocked(createManualBlock).mockRejectedValue(
      new BusinessError('PRACTITIONER_NOT_FOUND', 'Profissional não encontrado'),
    )

    const res = await post({ ...clinicWide, practitionerId: OTHER_ID })

    expect(res.status).toBe(404)
    expect((await res.json()).error).toBe('Profissional não encontrado')
    expect(createAuditLog).not.toHaveBeenCalled()
  })

  it('answers 400 with field errors for a timed block without an end', async () => {
    as('owner', OWNER_ID)

    const res = await post({ practitionerId: null, date: '2026-10-20', allDay: false, startTime: '09:00' })

    expect(res.status).toBe(400)
    expect((await res.json()).fieldErrors).toHaveProperty('startTime')
    expect(createManualBlock).not.toHaveBeenCalled()
  })

  it('returns the subscription block response untouched', async () => {
    const blocked = NextResponse.json({ error: 'Assinatura expirada' }, { status: 402 })
    vi.mocked(requireWrite).mockResolvedValue({ ctx: null, blocked })

    const res = await post(clinicWide)

    expect(res).toBe(blocked)
    expect(createManualBlock).not.toHaveBeenCalled()
  })
})
