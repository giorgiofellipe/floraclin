import { beforeEach, describe, expect, it, vi } from 'vitest'
import { calendarBlocks } from '@/db/schema'

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
    or: (...args: unknown[]) => {
      orSpy(...args)
      return (actual.or as (...a: unknown[]) => unknown)(...args)
    },
    isNull: (col: unknown) => {
      isNullSpy(col)
      return (actual.isNull as (c: unknown) => unknown)(col)
    },
  }
})

import { checkTimeConflict, getAvailableSlots } from '../appointments'

beforeEach(() => {
  vi.clearAllMocks()
  selectMock.mockReset()
})

describe('checkTimeConflict', () => {
  it('reports a conflict when a block covers the slot even with no appointment', async () => {
    // Regression: public booking rechecks only appointments at write time, so a slot blocked after the picker loaded was still bookable.
    selectMock.mockReturnValueOnce(chain([{ count: 0 }]))
    selectMock.mockReturnValueOnce(chain([{ count: 1 }]))
    expect(await checkTimeConflict('t1', 'p1', '2026-10-12', '10:00', '10:30')).toBe(true)
  })

  it('matches blocks for the practitioner or the whole clinic', async () => {
    // Pins the clinic-wide clause (null practitioner) in the new write-time block query.
    selectMock.mockReturnValueOnce(chain([{ count: 0 }]))
    selectMock.mockReturnValueOnce(chain([{ count: 0 }]))
    await checkTimeConflict('t1', 'p1', '2026-10-12', '10:00', '10:30')
    expect(isNullSpy).toHaveBeenCalledWith(calendarBlocks.practitionerId)
  })

  it('returns false when neither appointments nor blocks overlap', async () => {
    selectMock.mockReturnValueOnce(chain([{ count: 0 }]))
    selectMock.mockReturnValueOnce(chain([{ count: 0 }]))
    expect(await checkTimeConflict('t1', 'p1', '2026-10-12', '10:00', '10:30')).toBe(false)
  })
})

describe('getAvailableSlots', () => {
  const monday = { mon: { enabled: true, start: '08:00', end: '12:00' } }

  function queue(blocks: unknown[], appointments: unknown[] = []) {
    selectMock.mockReturnValueOnce(chain([{ workingHours: monday }]))
    selectMock.mockReturnValueOnce(chain(appointments))
    selectMock.mockReturnValueOnce(chain(blocks))
  }

  it('treats an appointment ending at 10:00 as free for the 10:00 slot even with seconds from the database', async () => {
    // Regression: the same string comparison hid the slot after an appointment, which public booking showed as taken.
    queue([], [{ startTime: '09:00:00', endTime: '10:00:00' }])
    const result = await getAvailableSlots('t1', 'p1', '2026-10-12', 30)
    expect(result.map((s) => s.start)).toEqual(['08:00', '08:30', '10:00', '10:30', '11:00', '11:30'])
  })

  it('returns no slots on a clinic-wide all-day block', async () => {
    // Regression: clinic-wide blocks were filtered out by an equality on the practitioner.
    queue([{ startTime: null, endTime: null, allDay: true }])
    const result = await getAvailableSlots('t1', 'p1', '2026-10-12', 30)
    expect(result).toEqual([])
    expect(isNullSpy).toHaveBeenCalledWith(calendarBlocks.practitionerId)
  })

  it('treats a block ending at 10:00 as free for the 10:00 slot even with seconds from the database', async () => {
    // Regression: '10:00:00' > '10:00' is true as strings, so the adjacent slot was suppressed.
    queue([{ startTime: '09:00:00', endTime: '10:00:00', allDay: false }])
    const result = await getAvailableSlots('t1', 'p1', '2026-10-12', 30)
    expect(result.map((s) => s.start)).toEqual(['08:00', '08:30', '10:00', '10:30', '11:00', '11:30'])
  })
})
