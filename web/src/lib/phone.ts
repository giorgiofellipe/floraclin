// One canonical form for every phone number we store or compare:
// 55 + DDD + subscriber, with the 9th digit present on mobiles.
//
// Two sources disagree and both have to collapse to the same string:
//   - Patient records are typed in national form, "(47) 98844-3635".
//   - Meta delivers `from` / `recipient_id` as "554788443635", without the 9th
//     digit, for accounts that predate Brazil's 2012-2016 renumbering.
//
// They are the same person. If the two produce different strings, an inbound
// reply finds no conversation and is dropped, which is exactly what happened
// to shared-number confirmations.

/**
 * Drop the country code only when the total length says it is one.
 *
 * A bare `startsWith('55')` test is wrong: DDD 55 is Santa Maria/RS, so the
 * national number 5533334444 would lose its area code and become a landline
 * in nowhere.
 */
function stripLeading55(digits: string): string {
  const hasCountryCode =
    (digits.length === 12 || digits.length === 13) && digits.startsWith('55')
  return hasCountryCode ? digits.slice(2) : digits
}

export function normalizeBrPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  const local = stripLeading55(digits)

  // DDD plus 8 or 9 subscriber digits is the only shape we can canonicalize.
  // Anything else (a foreign number, a half-typed entry) is returned as the
  // caller gave it rather than handed a 55 prefix it never had.
  if (local.length !== 10 && local.length !== 11) return digits

  const ddd = local.slice(0, 2)
  const subscriber = local.slice(2)

  // Real DDDs run 11 to 99 with no zero in either position. The check is what
  // keeps non-geographic numbers out: 0800 1234 567 is also 11 digits, and
  // without this it would be read as DDD 08 and rewritten into a geographic
  // number that does not exist.
  if (!/^[1-9][1-9]$/.test(ddd)) return digits

  // 8-digit subscribers starting 6-9 are mobiles from before the 9th digit.
  // Landlines start 2-5 and must never receive one.
  const withNinthDigit =
    subscriber.length === 8 && /^[6-9]/.test(subscriber)
      ? `9${subscriber}`
      : subscriber

  return `55${ddd}${withNinthDigit}`
}

/**
 * What Meta and wa.me expect. Identical to the canonical form, kept as its own
 * name so call sites reading as "about to send this somewhere" stay obvious.
 */
export function toWhatsAppPhone(phone: string): string {
  return normalizeBrPhone(phone)
}

export function formatBrPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  const local = stripLeading55(digits)

  if (local.length === 11) {
    return `(${local.slice(0, 2)}) ${local.slice(2, 7)}-${local.slice(7)}`
  }
  if (local.length === 10) {
    return `(${local.slice(0, 2)}) ${local.slice(2, 6)}-${local.slice(6)}`
  }
  return phone
}

export function stripCountryCode(phone: string): string {
  return stripLeading55(phone.replace(/\D/g, ''))
}
