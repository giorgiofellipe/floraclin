import { describe, it, expect } from 'vitest'
import { parseReferral, buildFbc } from '../attribution'

describe('buildFbc', () => {
  it('formats as fb.1.<unixMillis>.<fbclid>', () => {
    const clickedAt = new Date('2026-08-01T12:00:00.000Z')
    expect(buildFbc('IwAR123', clickedAt)).toBe(`fb.1.${clickedAt.getTime()}.IwAR123`)
  })

  it('defaults clickedAt to now when omitted', () => {
    const before = Date.now()
    const fbc = buildFbc('IwAR123')
    const after = Date.now()
    const match = fbc.match(/^fb\.1\.(\d+)\.IwAR123$/)
    expect(match).not.toBeNull()
    const millis = Number(match?.[1])
    expect(millis).toBeGreaterThanOrEqual(before)
    expect(millis).toBeLessThanOrEqual(after)
  })
})

describe('parseReferral', () => {
  it('returns null for undefined', () => {
    expect(parseReferral(undefined)).toBeNull()
  })

  it('returns null for an empty object', () => {
    expect(parseReferral({})).toBeNull()
  })

  it('returns null for null', () => {
    expect(parseReferral(null)).toBeNull()
  })

  it('returns null for a non-object value', () => {
    expect(parseReferral('not an object')).toBeNull()
  })

  it('maps source_id to adId and headline to adHeadline', () => {
    const result = parseReferral({
      source_id: '120210000000000',
      source_type: 'ad',
      source_url: 'https://fb.me/abc',
      headline: 'Botox promocional',
      body: 'Agende sua avaliação',
      media_type: 'image',
      ctwa_clid: 'AffQ123',
    })

    expect(result).toEqual({
      ctwaClid: 'AffQ123',
      adId: '120210000000000',
      adHeadline: 'Botox promocional',
      sourceUrl: 'https://fb.me/abc',
      sourceType: 'ad',
    })
  })

  it('keeps a referral with source_id but no ctwa_clid (organic post click)', () => {
    const result = parseReferral({
      source_id: '120210000000000',
      source_type: 'post',
      source_url: 'https://fb.me/abc',
    })

    expect(result).toEqual({
      adId: '120210000000000',
      sourceUrl: 'https://fb.me/abc',
      sourceType: 'post',
    })
    expect(result?.ctwaClid).toBeUndefined()
  })

  it('captures ctwa_clid alone when no ad metadata is present', () => {
    const result = parseReferral({ ctwa_clid: 'AffQ123' })
    expect(result).toEqual({ ctwaClid: 'AffQ123' })
  })
})
