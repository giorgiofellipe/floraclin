import { describe, expect, it } from 'vitest'
import { formatElapsedSince } from '../signup-notifications'

describe('formatElapsedSince', () => {
  const start = new Date('2026-10-22T12:00:00.000Z')
  const after = (ms: number) => new Date(start.getTime() + ms)
  const MIN = 60_000

  it.each([
    [30_000, 'em menos de 1 min'],
    [4 * MIN + 59_000, 'em 4 min'],
    [59 * MIN, 'em 59 min'],
    [60 * MIN, 'em 1 h'],
    [125 * MIN, 'em 2 h 5 min'],
    [24 * 60 * MIN, 'em 1 dia'],
    [3 * 24 * 60 * MIN + 7 * MIN, 'em 3 dias'],
    [-5 * MIN, 'em menos de 1 min'],
  ])('formats %i ms as %s', (ms, expected) => {
    expect(formatElapsedSince(start, after(ms))).toBe(expected)
  })
})
