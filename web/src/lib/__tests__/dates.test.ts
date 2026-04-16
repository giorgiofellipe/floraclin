import { describe, it, expect } from 'vitest'
import {
  BR_TZ,
  parseBrDate,
  startOfBrDay,
  endOfBrDay,
  parseLocalDate,
  brToday,
  toBrYmd,
  toLocalYmd,
} from '../dates'
import { formatInTimeZone } from 'date-fns-tz'

describe('dates helpers', () => {
  describe('parseBrDate', () => {
    it('anchors YYYY-MM-DD at the given BR-local clock time', () => {
      const d = parseBrDate('2026-04-16', '12:00:00')
      // BR noon is 15:00 UTC (BRT is UTC-3)
      expect(d.toISOString()).toBe('2026-04-16T15:00:00.000Z')
    })

    it('defaults to BR noon when time omitted', () => {
      const d = parseBrDate('2026-04-16')
      expect(d.toISOString()).toBe('2026-04-16T15:00:00.000Z')
    })

    it('rejects non-YYYY-MM-DD input', () => {
      expect(() => parseBrDate('2026/04/16')).toThrow(/expected YYYY-MM-DD/)
      expect(() => parseBrDate('invalid')).toThrow(/expected YYYY-MM-DD/)
    })
  })

  describe('startOfBrDay / endOfBrDay', () => {
    it('produces BR midnight as UTC 03:00 the same day', () => {
      const start = startOfBrDay('2026-04-16')
      expect(start.toISOString()).toBe('2026-04-16T03:00:00.000Z')
    })

    it('produces BR end-of-day as UTC 02:59:59.999 the next day', () => {
      const end = endOfBrDay('2026-04-16')
      expect(end.toISOString()).toBe('2026-04-17T02:59:59.999Z')
    })

    it('filter range covers a full BR calendar day even when the host is UTC', () => {
      // A payment made at 23:30 BR on 2026-04-16 is a real instant 02:30Z on 2026-04-17
      const paidAt = new Date('2026-04-17T02:30:00.000Z')
      const start = startOfBrDay('2026-04-16')
      const end = endOfBrDay('2026-04-16')
      expect(paidAt.getTime()).toBeGreaterThanOrEqual(start.getTime())
      expect(paidAt.getTime()).toBeLessThanOrEqual(end.getTime())
    })

    it('filter range rejects a payment from the previous BR day', () => {
      // 23:30 BR on 2026-04-15 is 02:30Z on 2026-04-16 — same UTC day as our query's start
      // but a different BR calendar day
      const paidAt = new Date('2026-04-16T02:30:00.000Z')
      const start = startOfBrDay('2026-04-16')
      expect(paidAt.getTime()).toBeLessThan(start.getTime())
    })
  })

  describe('parseLocalDate', () => {
    it('appends T time and parses with local TZ', () => {
      const d = parseLocalDate('2026-04-16', '00:00:00')
      // The exact UTC offset depends on the test runner's TZ, but the
      // local y/m/d must match what we passed.
      expect(formatInTimeZone(d, Intl.DateTimeFormat().resolvedOptions().timeZone, 'yyyy-MM-dd')).toBe('2026-04-16')
    })

    it('rejects non-YYYY-MM-DD', () => {
      expect(() => parseLocalDate('not-a-date')).toThrow()
    })
  })

  describe('brToday / toBrYmd', () => {
    it('returns a YYYY-MM-DD string', () => {
      expect(brToday()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    })

    it('formats a known UTC instant to the right BR calendar day', () => {
      // 2026-04-17T02:30Z is still 2026-04-16 in BR (BRT is UTC-3 → 23:30 BR)
      expect(toBrYmd(new Date('2026-04-17T02:30:00Z'))).toBe('2026-04-16')
      // 2026-04-17T03:00Z is exactly 00:00 BR on 2026-04-17
      expect(toBrYmd(new Date('2026-04-17T03:00:00Z'))).toBe('2026-04-17')
    })
  })

  describe('toLocalYmd', () => {
    it('does not round-trip through UTC (no day-flip bug)', () => {
      // Construct a BR-local 2026-04-16 23:30 as a real Date (uses host TZ).
      // `.toISOString().split('T')[0]` would return the UTC date (possibly next day on UTC host)
      // while `toLocalYmd` should return the host-local date.
      const ymd = '2026-04-16'
      const d = parseLocalDate(ymd, '23:30:00')
      expect(toLocalYmd(d)).toBe('2026-04-16')
    })
  })

  describe('BR_TZ constant', () => {
    it('is the canonical IANA timezone string', () => {
      expect(BR_TZ).toBe('America/Sao_Paulo')
    })
  })
})
