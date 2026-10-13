import { BusinessError } from '@/lib/errors'

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

const VALID_BR_DDDS = new Set([
  '11', '12', '13', '14', '15', '16', '17', '18', '19',
  '21', '22', '24', '27', '28',
  '31', '32', '33', '34', '35', '37', '38',
  '41', '42', '43', '44', '45', '46',
  '47', '48', '49',
  '51', '53', '54', '55',
  '61', '62', '63', '64', '65', '66', '67', '68', '69',
  '71', '73', '74', '75', '77', '79',
  '81', '82', '83', '84', '85', '86', '87', '88', '89',
  '91', '92', '93', '94', '95', '96', '97', '98', '99',
])

export class InvalidWhatsAppPhoneError extends BusinessError {
  constructor(message: string) {
    super('WHATSAPP_INVALID_PHONE', message)
    this.name = 'InvalidWhatsAppPhoneError'
  }
}

export function isCanonicalBrPhone(phone: string): boolean {
  return /^55\d{10,11}$/.test(phone)
}

export function normalizeBrPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  const local = stripLeading55(stripBrazilOutboundPrefix(digits))

  // DDD plus 8 or 9 subscriber digits is the only shape we can canonicalize.
  // Anything else (a foreign number, a half-typed entry) is returned as the
  // caller gave it rather than handed a 55 prefix it never had.
  if (local.length !== 10 && local.length !== 11) return digits

  const ddd = local.slice(0, 2)
  const subscriber = local.slice(2)

  // Real DDDs run 11 to 99 with no zero in either position. The check is what
  // keeps non-geographic numbers out: 0800 1234 567 loses its leading 0 as a
  // trunk prefix and reads as DDD 80, which would otherwise be rewritten into a
  // geographic number that does not exist.
  if (!/^[1-9][1-9]$/.test(ddd)) return digits

  // 8-digit subscribers starting 6-9 are mobiles from before the 9th digit.
  // Landlines start 2-5 and must never receive one.
  const withNinthDigit =
    subscriber.length === 8 && /^[6-9]/.test(subscriber)
      ? `9${subscriber}`
      : subscriber

  return `55${ddd}${withNinthDigit}`
}

function stripBrazilOutboundPrefix(digits: string): string {
  let candidate = digits

  // Some exports include the international call prefix: 00 55 DDD number.
  if ((candidate.length === 14 || candidate.length === 15) && candidate.startsWith('0055')) {
    candidate = candidate.slice(2)
  }

  // National long-distance forms: 0 + DDD + number, or 0 + carrier + DDD + number.
  // Examples: 047988443635 and 04147988443635 both become 47988443635.
  // Neither a DDD nor a carrier code starts with 0, so a remaining 00 is the
  // international prefix of another country (0044..., 001...).
  if (!/^0[1-9]/.test(candidate)) return candidate
  if (candidate.length === 11 || candidate.length === 12) return candidate.slice(1)
  if (candidate.length === 13 || candidate.length === 14) return candidate.slice(3)

  return candidate
}

type PhoneNormalizationResult =
  | { ok: true; phone: string }
  | { ok: false; reason: string }

export function tryNormalizeBrPhoneForWhatsApp(phone: string): PhoneNormalizationResult {
  const digits = phone.replace(/\D/g, '')
  if (!digits) return { ok: false, reason: 'Telefone vazio.' }

  const local = stripLeading55(stripBrazilOutboundPrefix(digits))
  if (local.length !== 10 && local.length !== 11) {
    return { ok: false, reason: 'Telefone deve ter DDD e 8 ou 9 dígitos.' }
  }

  const ddd = local.slice(0, 2)
  if (!VALID_BR_DDDS.has(ddd)) {
    return { ok: false, reason: 'DDD brasileiro inválido.' }
  }

  const subscriber = local.slice(2)
  if (subscriber.length === 8) {
    if (/^[2-5]/.test(subscriber)) return { ok: true, phone: `55${ddd}${subscriber}` }
    if (/^[6-9]/.test(subscriber)) return { ok: true, phone: `55${ddd}9${subscriber}` }
    return { ok: false, reason: 'Número local inválido.' }
  }

  if (/^9\d{8}$/.test(subscriber)) return { ok: true, phone: `55${local}` }

  return { ok: false, reason: 'Celular brasileiro deve começar com 9 após o DDD.' }
}

export function normalizeBrPhoneForWhatsApp(phone: string): string {
  const result = tryNormalizeBrPhoneForWhatsApp(phone)
  if (!result.ok) {
    throw new InvalidWhatsAppPhoneError(result.reason)
  }
  return result.phone
}

/**
 * wa.me accepts any country, so this uses the lenient normalizer: a foreign
 * patient still gets a link with their digits as typed.
 */
export function toWaMeUrl(phone: string, text?: string): string | null {
  const digits = normalizeBrPhone(phone)
  if (!digits) return null
  const query = text ? `?text=${encodeURIComponent(text)}` : ''
  return `https://wa.me/${digits}${query}`
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
