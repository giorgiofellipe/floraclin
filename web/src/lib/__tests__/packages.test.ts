import { describe, it, expect } from 'vitest'
import { computePackageExpiresAt, shouldCompletePackage } from '../packages'

describe('computePackageExpiresAt', () => {
  it('returns null when validity is null', () => {
    expect(computePackageExpiresAt(null, '2026-05-27')).toBeNull()
  })

  it('returns null when validity is undefined', () => {
    expect(computePackageExpiresAt(undefined, '2026-05-27')).toBeNull()
  })

  it('adds whole months to a BR-anchored today', () => {
    expect(computePackageExpiresAt(3, '2026-05-27')).toBe('2026-08-27')
  })

  it('handles month rollover at year boundary', () => {
    expect(computePackageExpiresAt(2, '2026-11-15')).toBe('2027-01-15')
  })

  it('clamps day when target month is shorter (date-fns addMonths semantics)', () => {
    // Jan 31 + 1 month = Feb 28 (or 29 in leap year)
    expect(computePackageExpiresAt(1, '2026-01-31')).toBe('2026-02-28')
  })

  it('handles 12 months (one year)', () => {
    expect(computePackageExpiresAt(12, '2026-05-27')).toBe('2027-05-27')
  })
})

describe('shouldCompletePackage', () => {
  it('returns false for an empty package', () => {
    expect(shouldCompletePackage([])).toBe(false)
  })

  it('returns false when one line is short', () => {
    expect(
      shouldCompletePackage([
        { sessionsTotal: 4, executedCount: 4 },
        { sessionsTotal: 4, executedCount: 3 },
      ]),
    ).toBe(false)
  })

  it('returns true when every line is fully executed', () => {
    expect(
      shouldCompletePackage([
        { sessionsTotal: 4, executedCount: 4 },
        { sessionsTotal: 2, executedCount: 2 },
      ]),
    ).toBe(true)
  })

  it('returns true when executed exceeds total (safety against drift)', () => {
    expect(
      shouldCompletePackage([
        { sessionsTotal: 4, executedCount: 5 },
      ]),
    ).toBe(true)
  })

  it('returns false when no executions yet', () => {
    expect(
      shouldCompletePackage([
        { sessionsTotal: 4, executedCount: 0 },
        { sessionsTotal: 2, executedCount: 0 },
      ]),
    ).toBe(false)
  })

  it('returns true for a single fully-consumed line', () => {
    expect(
      shouldCompletePackage([{ sessionsTotal: 1, executedCount: 1 }]),
    ).toBe(true)
  })
})
