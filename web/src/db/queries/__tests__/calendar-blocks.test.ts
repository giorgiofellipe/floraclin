import { describe, it, expect, vi, beforeEach } from 'vitest'
import { calendarBlocks } from '@/db/schema'

// Thenable builder: every method returns the chain; awaiting it yields `result`.
function chain(result: unknown) {
  const c: Record<string, unknown> = {}
  for (const m of ['select', 'from', 'leftJoin', 'innerJoin', 'where', 'orderBy', 'limit', 'insert', 'values', 'returning', 'update', 'set', 'delete']) {
    c[m] = vi.fn(() => c)
  }
  c.then = (resolve: (v: unknown) => void) => resolve(result)
  return c
}

const { selectMock, insertMock } = vi.hoisted(() => ({ selectMock: vi.fn(), insertMock: vi.fn() }))
vi.mock('@/db/client', () => ({ db: { select: selectMock, insert: insertMock } }))

const { orSpy, isNullSpy } = vi.hoisted(() => ({ orSpy: vi.fn(), isNullSpy: vi.fn() }))
vi.mock('drizzle-orm', async () => {
  const actual = await vi.importActual<typeof import('drizzle-orm')>('drizzle-orm')
  return {
    ...actual,
    or: (...args: unknown[]) => { orSpy(...args); return (actual.or as (...a: unknown[]) => unknown)(...args) },
    isNull: (col: unknown) => { isNullSpy(col); return (actual.isNull as (c: unknown) => unknown)(col) },
  }
})

import { listBlocksForDateRange, createManualBlock, upsertCalendarBlock } from '../calendar'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('listBlocksForDateRange', () => {
  it('includes clinic-wide blocks when filtering by practitioner', async () => {
    // Regression: a filter of practitioner_id = X alone hides the clinic closure from that practitioner's agenda.
    selectMock.mockReturnValueOnce(chain([]))
    await listBlocksForDateRange('t1', 'p1', '2026-10-12', '2026-10-18')
    expect(isNullSpy).toHaveBeenCalledWith(calendarBlocks.practitionerId)
  })

  it('does not add the clinic-wide clause without a practitioner filter', async () => {
    selectMock.mockReturnValueOnce(chain([]))
    await listBlocksForDateRange('t1', undefined, '2026-10-12', '2026-10-18')
    expect(orSpy).not.toHaveBeenCalled()
  })

  it('left joins users so a clinic-wide block survives the join', async () => {
    // Regression: innerJoin drops rows whose practitioner_id is NULL.
    const c = chain([])
    selectMock.mockReturnValueOnce(c)
    await listBlocksForDateRange('t1', undefined, '2026-10-12', '2026-10-18')
    expect(c.leftJoin).toHaveBeenCalled()
    expect(c.innerJoin).not.toHaveBeenCalled()
  })
})

describe('createManualBlock', () => {
  it('inserts source manual with no connection or google event id', async () => {
    selectMock.mockReturnValueOnce(chain([{ id: 'p1' }]))
    const ins = chain([{ id: 'b1' }])
    insertMock.mockReturnValueOnce(ins)
    await createManualBlock('t1', { practitionerId: 'p1', title: null, date: '2026-10-12', startTime: '12:00', endTime: '13:00', allDay: false })
    expect(ins.values).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 't1', source: 'manual', connectionId: null, googleEventId: null, practitionerId: 'p1' }))
  })

  it('skips the membership check for a clinic-wide block', async () => {
    const ins = chain([{ id: 'b1' }])
    insertMock.mockReturnValueOnce(ins)
    await createManualBlock('t1', { practitionerId: null, title: 'Fechado', date: '2026-10-12', startTime: null, endTime: null, allDay: true })
    expect(selectMock).not.toHaveBeenCalled()
  })

  it('refuses a practitioner outside the tenant or without a clinical role', async () => {
    // Regression: the FK points at users, not tenant membership, so an owner could pin a block to any user id in the system.
    selectMock.mockReturnValueOnce(chain([]))
    await expect(
      createManualBlock('t1', { practitionerId: 'stranger', title: null, date: '2026-10-12', startTime: null, endTime: null, allDay: true }),
    ).rejects.toMatchObject({ code: 'PRACTITIONER_NOT_FOUND' })
    expect(insertMock).not.toHaveBeenCalled()
  })
})

describe('upsertCalendarBlock', () => {
  it('stamps source google on insert', async () => {
    selectMock.mockReturnValueOnce(chain([]))
    const ins = chain([{ id: 'b1' }])
    insertMock.mockReturnValueOnce(ins)
    await upsertCalendarBlock({ tenantId: 't1', practitionerId: 'p1', connectionId: 'c1', googleEventId: 'g1', title: null, date: '2026-10-12', startTime: null, endTime: null, allDay: true, status: 'confirmed' })
    expect(ins.values).toHaveBeenCalledWith(expect.objectContaining({ source: 'google' }))
  })
})
