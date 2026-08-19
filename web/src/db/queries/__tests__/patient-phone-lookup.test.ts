import { describe, expect, it } from 'vitest'
import { phoneTailVariants } from '@/db/queries/patients'

/**
 * `patients.phone` is never normalized: it holds exactly what the clinic typed.
 * Callers now pass the canonical `5547988443635`, so the lookup has to match
 * every shape the column can legitimately hold.
 *
 * A miss is not harmless. The webhook passes the result straight into
 * `upsertConversation` as `patientId: patient?.id ?? null`, and `null` is
 * written rather than ignored, so a failed match actively clears an existing
 * patient link on the conversation.
 */
function matches(variants: string[], storedPhone: string): boolean {
  const digits = storedPhone.replace(/\D/g, '')
  // Mirrors the SQL: right(digits, len) = variant.
  return variants.some((v) => digits.slice(-v.length) === v)
}

describe('phoneTailVariants', () => {
  const variants = phoneTailVariants('5547988443635')

  it('matches every shape the clinic could have typed', () => {
    expect(matches(variants, '(47) 98844-3635')).toBe(true)
    expect(matches(variants, '+55 (47) 98844-3635')).toBe(true)
    expect(matches(variants, '5547988443635')).toBe(true)
    // Stored before the 9th digit was added.
    expect(matches(variants, '(47) 8844-3635')).toBe(true)
  })

  it('does not match a different person', () => {
    expect(matches(variants, '(47) 98844-3636')).toBe(false)
    // Same subscriber digits, different area code.
    expect(matches(variants, '(11) 98844-3635')).toBe(false)
  })

  it('accepts the raw and the canonical form of the same input', () => {
    expect(phoneTailVariants('(47) 98844-3635')).toEqual(variants)
    expect(phoneTailVariants('554788443635')).toEqual(variants)
  })

  it('does not invent a 9th digit for a landline', () => {
    const landline = phoneTailVariants('554733334444')
    expect(landline).toEqual(['4733334444'])
    expect(matches(landline, '(47) 3333-4444')).toBe(true)
    expect(matches(landline, '+55 (47) 3333-4444')).toBe(true)
    // The mobile in the same area with the same subscriber digits is a
    // different line and must not be pulled in.
    expect(matches(landline, '(47) 93333-4444')).toBe(false)
  })

  it('returns nothing to match on for input it cannot place', () => {
    // The caller falls back to an exact digit comparison. Matching a tail on a
    // short string would pull in unrelated patients.
    expect(phoneTailVariants('12345')).toEqual([])
    expect(phoneTailVariants('08001234567')).toEqual([])
    expect(phoneTailVariants('447911123456')).toEqual([])
  })
})
