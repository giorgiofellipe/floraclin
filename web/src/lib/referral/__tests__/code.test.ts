import { describe, expect, it } from 'vitest'
import { generateReferralCode } from '../code'
import { REFERRAL_CODE_ALPHABET } from '../rules'

describe('generateReferralCode', () => {
  it('makes 6 chars from the alphabet', () => {
    const code = generateReferralCode()
    expect(code).toHaveLength(6)
    for (const char of code) expect(REFERRAL_CODE_ALPHABET).toContain(char)
  })

  it('skips bytes ≥ 248 and maps the rest by modulo', () => {
    const bytes = Uint8Array.from([248, 0, 30, 255, 1, 2, 3, 4, 5, 6, 7, 8])
    expect(generateReferralCode(() => bytes)).toBe('A9BCDE')
  })

  it('asks for more bytes when too many are rejected', () => {
    const batches = [new Uint8Array(12).fill(250), Uint8Array.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])]
    expect(generateReferralCode(() => batches.shift()!)).toBe('ABCDEF')
  })

  it('uses an alphabet without 0 O 1 I L', () => {
    expect(REFERRAL_CODE_ALPHABET).not.toMatch(/[0O1IL]/)
  })
})
