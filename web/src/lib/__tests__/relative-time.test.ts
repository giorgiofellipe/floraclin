import { describe, it, expect } from 'vitest'
import { formatRelativeSaveTime } from '../relative-time'

describe('formatRelativeSaveTime', () => {
  const now = new Date('2026-04-14T12:00:00Z')

  it('returns "Salvo agora" when saved < 1 minute ago', () => {
    expect(formatRelativeSaveTime(new Date('2026-04-14T11:59:40Z'), now)).toBe('Salvo agora')
  })
  it('returns "Salvo há 1min" at exactly 1 minute', () => {
    expect(formatRelativeSaveTime(new Date('2026-04-14T11:59:00Z'), now)).toBe('Salvo há 1min')
  })
  it('returns "Salvo há 59min" at 59 minutes', () => {
    expect(formatRelativeSaveTime(new Date('2026-04-14T11:01:00Z'), now)).toBe('Salvo há 59min')
  })
  it('returns "Salvo há 1h" at 60 minutes', () => {
    expect(formatRelativeSaveTime(new Date('2026-04-14T11:00:00Z'), now)).toBe('Salvo há 1h')
  })
  it('returns "Salvo há 23h" at 23 hours', () => {
    expect(formatRelativeSaveTime(new Date('2026-04-13T13:00:00Z'), now)).toBe('Salvo há 23h')
  })
  it('returns "Salvo há 1d" at 24 hours', () => {
    expect(formatRelativeSaveTime(new Date('2026-04-13T12:00:00Z'), now)).toBe('Salvo há 1d')
  })
  it('clamps negative differences to "Salvo agora"', () => {
    expect(formatRelativeSaveTime(new Date('2026-04-14T12:00:10Z'), now)).toBe('Salvo agora')
  })
})
