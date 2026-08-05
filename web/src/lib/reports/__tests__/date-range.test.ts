import { describe, it, expect } from 'vitest'
import { resolveDateRange } from '../date-range'

// Fixed "today" so these never depend on the clock or the host timezone.
const TODAY = '2026-08-03'
const OPTS = { defaultRangeDays: 90, today: TODAY }

describe('resolveDateRange', () => {
  describe('nothing given', () => {
    it('falls back to the last 90 days up to today', () => {
      expect(resolveDateRange(null, null, OPTS)).toEqual({
        ok: true,
        dateFrom: '2026-05-05',
        dateTo: TODAY,
      })
    })

    it('treats blank strings the same as absent params', () => {
      expect(resolveDateRange('', '   ', OPTS)).toEqual({
        ok: true,
        dateFrom: '2026-05-05',
        dateTo: TODAY,
      })
    })

    it('honours the per-report defaultRangeDays instead of a hardcoded 90', () => {
      expect(resolveDateRange(null, null, { defaultRangeDays: 30, today: TODAY })).toEqual({
        ok: true,
        dateFrom: '2026-07-04',
        dateTo: TODAY,
      })
    })
  })

  describe('partial range', () => {
    it('completes a missing dateTo with today', () => {
      expect(resolveDateRange('2026-01-15', null, OPTS)).toEqual({
        ok: true,
        dateFrom: '2026-01-15',
        dateTo: TODAY,
      })
    })

    it('completes a missing dateFrom with defaultRangeDays before dateTo', () => {
      expect(resolveDateRange(null, '2026-06-30', OPTS)).toEqual({
        ok: true,
        dateFrom: '2026-04-01',
        dateTo: '2026-06-30',
      })
    })

    it('never inverts the range when only a future dateFrom is given', () => {
      // The user never typed an end date, so a 400 would blame them for an
      // ordering they didn't choose: clamp to a single day instead.
      expect(resolveDateRange('2027-01-10', null, OPTS)).toEqual({
        ok: true,
        dateFrom: '2027-01-10',
        dateTo: '2027-01-10',
      })
    })
  })

  describe('both given', () => {
    it('passes a well-formed range through untouched', () => {
      expect(resolveDateRange('2026-04-01', '2026-04-30', OPTS)).toEqual({
        ok: true,
        dateFrom: '2026-04-01',
        dateTo: '2026-04-30',
      })
    })

    it('allows a single-day range', () => {
      expect(resolveDateRange('2026-04-01', '2026-04-01', OPTS)).toEqual({
        ok: true,
        dateFrom: '2026-04-01',
        dateTo: '2026-04-01',
      })
    })

    it('rejects dateFrom after dateTo', () => {
      const result = resolveDateRange('2026-05-01', '2026-04-01', OPTS)

      expect(result.ok).toBe(false)
      expect(result).toMatchObject({ error: 'Data inicial posterior à data final' })
    })
  })

  describe('malformed values', () => {
    it.each(['04-2026', '2026/04/01', '01/04/2026', 'hoje', '2026-4-1'])(
      'rejects the badly shaped dateFrom %s',
      (raw) => {
        expect(resolveDateRange(raw, '2026-04-30', OPTS).ok).toBe(false)
      },
    )

    it.each(['2026-02-31', '2026-13-01', '2026-00-10'])(
      'rejects the impossible calendar day %s',
      (raw) => {
        expect(resolveDateRange('2026-01-01', raw, OPTS).ok).toBe(false)
      },
    )

    it('rejects a malformed value even when it is the only one given', () => {
      expect(resolveDateRange('04-2026', null, OPTS).ok).toBe(false)
      expect(resolveDateRange(null, '04-2026', OPTS).ok).toBe(false)
    })
  })
})
