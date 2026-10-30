import { describe, expect, it } from 'vitest'
import { WELCOME_PROMOTION_CODE } from '../coupon-setup'
import { CUSTOM_CODE_MESSAGES, isReservedReferralCode, validateCustomReferralCode } from '../custom-code'

describe('validateCustomReferralCode', () => {
  it('trims and uppercases a spoken-style code, keeping look-alike letters', () => {
    expect(validateCustomReferralCode('  draMicaela ')).toEqual({ ok: true, code: 'DRAMICAELA' })
    expect(validateCustomReferralCode('hof2026')).toEqual({ ok: true, code: 'HOF2026' })
  })

  it.each([
    ['too short', 'ABC'],
    ['too long', 'DRAMICAELAHOF'],
    ['a space', 'DRA MICAELA'],
    ['an accent', 'CLÍNICA'],
    ['a symbol', 'DRA-MICA'],
    ['empty', ''],
    ['not a string', 42],
  ])('rejects %s', (_label, raw) => {
    expect(validateCustomReferralCode(raw)).toEqual({ ok: false, reason: 'format', message: CUSTOM_CODE_MESSAGES.format })
  })

  it.each(['FLORACLIN', 'floraclin', 'ADMIN', 'SUPORTE', 'INDICA20', 'VOLTA30', 'FEEDBACK50', WELCOME_PROMOTION_CODE])(
    'rejects the reserved code %s',
    (raw) => {
      expect(validateCustomReferralCode(raw)).toEqual({
        ok: false,
        reason: 'reserved',
        message: CUSTOM_CODE_MESSAGES.reserved,
      })
    },
  )

  it('rejects codes that read as ours even with a suffix', () => {
    expect(isReservedReferralCode('FLORACLIN10')).toBe(true)
    expect(isReservedReferralCode('SUPORTEVIP')).toBe(true)
    expect(isReservedReferralCode('DRAMICAELA')).toBe(false)
  })
})
