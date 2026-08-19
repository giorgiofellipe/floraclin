import { describe, expect, it } from 'vitest'
import {
  formatBrPhone,
  normalizeBrPhone,
  stripCountryCode,
  toWhatsAppPhone,
} from '@/lib/phone'

/**
 * The bug these tests exist for: a patient record and Meta's `from` field
 * describe the same person in different shapes, and the webhook looks the
 * conversation up by string equality. When the two shapes normalized to
 * different strings, every inbound reply and every delivery status on the
 * shared number was dropped before anything was written.
 */
describe('normalizeBrPhone', () => {
  it('collapses the patient-record shape and the Meta shape to one string', () => {
    // What the clinic typed into the patient record.
    const fromPatientRecord = normalizeBrPhone('(47) 98844-3635')
    // What Meta puts in `from`, without the 9th digit.
    const fromMetaWebhook = normalizeBrPhone('554788443635')

    expect(fromPatientRecord).toBe(fromMetaWebhook)
    expect(fromPatientRecord).toBe('5547988443635')
  })

  it('adds the missing 9th digit to an 8-digit mobile', () => {
    expect(normalizeBrPhone('554788443635')).toBe('5547988443635')
    expect(normalizeBrPhone('4788443635')).toBe('5547988443635')
  })

  it('does not add a 9th digit to a landline', () => {
    // Landline subscribers start 2-5 and keep 8 digits.
    expect(normalizeBrPhone('554733334444')).toBe('554733334444')
    expect(normalizeBrPhone('4733334444')).toBe('554733334444')
  })

  it('is idempotent', () => {
    const once = normalizeBrPhone('(47) 98844-3635')
    expect(normalizeBrPhone(once)).toBe(once)
    expect(normalizeBrPhone(normalizeBrPhone(once))).toBe(once)
  })

  it('keeps DDD 55 intact instead of reading it as the country code', () => {
    // Santa Maria/RS is DDD 55. A bare startsWith('55') check eats the area
    // code and turns a valid number into a broken one.
    expect(normalizeBrPhone('5533334444')).toBe('555533334444')
    expect(normalizeBrPhone('55987654321')).toBe('5555987654321')
    // And the already-canonical form of that same number survives a round trip.
    expect(normalizeBrPhone('5555987654321')).toBe('5555987654321')
  })

  it('strips formatting characters', () => {
    expect(normalizeBrPhone('+55 (47) 98844-3635')).toBe('5547988443635')
    expect(normalizeBrPhone('55 47 9 8844 3635')).toBe('5547988443635')
  })

  it('leaves non-geographic numbers alone', () => {
    // 0800 numbers are also 11 digits. Read as DDD 08 they would be rewritten
    // into a geographic number that does not exist, and the migration would
    // have written that corruption to the database.
    expect(normalizeBrPhone('08001234567')).toBe('08001234567')
    expect(normalizeBrPhone('0800123456')).toBe('0800123456')
    // No valid DDD has a zero in either position.
    expect(normalizeBrPhone('10987654321')).toBe('10987654321')
    expect(normalizeBrPhone('01987654321')).toBe('01987654321')
  })

  it('returns unrecognized input as plain digits rather than inventing a prefix', () => {
    // A number we cannot place must not be handed a 55 it never had, or it
    // would silently become a wrong Brazilian number.
    expect(normalizeBrPhone('12345')).toBe('12345')
    expect(normalizeBrPhone('447911123456')).toBe('447911123456')
    expect(normalizeBrPhone('')).toBe('')
  })
})

describe('toWhatsAppPhone', () => {
  it('produces the wire format Meta and wa.me expect', () => {
    expect(toWhatsAppPhone('(47) 98844-3635')).toBe('5547988443635')
    expect(toWhatsAppPhone('554788443635')).toBe('5547988443635')
  })

  it('does not double the country code on an already-canonical number', () => {
    expect(toWhatsAppPhone('5547988443635')).toBe('5547988443635')
  })
})

describe('formatBrPhone', () => {
  it('renders the canonical form for humans', () => {
    expect(formatBrPhone('5547988443635')).toBe('(47) 98844-3635')
    expect(formatBrPhone('554733334444')).toBe('(47) 3333-4444')
  })

  it('renders a national number too', () => {
    expect(formatBrPhone('47988443635')).toBe('(47) 98844-3635')
  })

  it('does not eat DDD 55', () => {
    expect(formatBrPhone('5555987654321')).toBe('(55) 98765-4321')
  })

  it('returns the input untouched when it is not a Brazilian number', () => {
    expect(formatBrPhone('12345')).toBe('12345')
  })
})

describe('stripCountryCode', () => {
  it('removes the country code from the canonical form', () => {
    expect(stripCountryCode('5547988443635')).toBe('47988443635')
  })

  it('leaves a national number alone', () => {
    expect(stripCountryCode('47988443635')).toBe('47988443635')
  })

  it('does not mistake DDD 55 for the country code', () => {
    expect(stripCountryCode('5533334444')).toBe('5533334444')
  })
})
