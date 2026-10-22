import { WELCOME_PROMOTION_CODE } from './coupon-setup'
import { REFERRAL_CODE_MAX_LENGTH, REFERRAL_CODE_MIN_LENGTH, normalizeReferralCode } from './rules'

/** A clinic may change its code this many times in a rolling 24 h window. */
export const REFERRAL_CODE_CHANGES_PER_DAY = 3
export const REFERRAL_CODE_CHANGE_WINDOW_MS = 24 * 60 * 60 * 1000
/** Old codes keep working forever; past this many, the clinic can only switch back to one of them. */
export const MAX_PREVIOUS_REFERRAL_CODES = 5

// Win-back promotion code clinics type at checkout; its id lives in STRIPE_WINBACK_PROMOTION_CODE_ID, not the string.
const WINBACK_PROMOTION_CODE = 'VOLTA30'

/** Exact codes no clinic may take: our brand, staff roles, and the Stripe promotion codes we hand out. */
export const RESERVED_REFERRAL_CODES: ReadonlySet<string> = new Set([
  'FLORACLIN',
  'FLORA',
  'ADMIN',
  'ADMINISTRADOR',
  'SUPORTE',
  'SUPPORT',
  'AJUDA',
  'OFICIAL',
  'EQUIPE',
  'TESTE',
  WELCOME_PROMOTION_CODE,
  WINBACK_PROMOTION_CODE,
])

/** Any code containing one of these reads as ours (FLORACLIN10, SUPORTEFLORA…). Substring match: PADMINI is blocked too, on purpose. */
const RESERVED_FRAGMENTS = ['FLORACLIN', 'SUPORTE', 'ADMIN']

export type CustomCodeValidation =
  | { ok: true; code: string }
  | { ok: false; reason: 'format' | 'reserved'; message: string }

export const CUSTOM_CODE_MESSAGES = {
  format: `Use de ${REFERRAL_CODE_MIN_LENGTH} a ${REFERRAL_CODE_MAX_LENGTH} letras ou números, sem espaços, acentos ou símbolos.`,
  reserved: 'Esse código é reservado. Escolha outro.',
  taken: 'Esse código já está em uso por outra clínica. Escolha outro.',
  rateLimited: `Você já trocou o código ${REFERRAL_CODE_CHANGES_PER_DAY} vezes nas últimas 24 horas. Tente de novo mais tarde.`,
  aliasLimit: `Você já tem ${MAX_PREVIOUS_REFERRAL_CODES} códigos anteriores, que continuam funcionando. Agora só é possível voltar para um deles.`,
} as const

export function isReservedReferralCode(code: string): boolean {
  return RESERVED_REFERRAL_CODES.has(code) || RESERVED_FRAGMENTS.some((fragment) => code.includes(fragment))
}

/** Format and reserved-list check for a code the clinic typed. Uniqueness needs the DB (updateReferralCode). */
export function validateCustomReferralCode(raw: unknown): CustomCodeValidation {
  const code = normalizeReferralCode(raw)
  if (!code) return { ok: false, reason: 'format', message: CUSTOM_CODE_MESSAGES.format }
  if (isReservedReferralCode(code)) return { ok: false, reason: 'reserved', message: CUSTOM_CODE_MESSAGES.reserved }
  return { ok: true, code }
}


/** Per-client cap on cache-missing public code lookups (GET /api/referral/codes/[code]), per server instance. */
export const CODE_LOOKUPS_PER_MINUTE = 60

/**
 * Whether to show a format error for what the user has typed so far: not while a short code is still being typed,
 * only once it is long enough, has a character codes never contain, or the field was left (`blurred`).
 */
export function shouldShowReferralFormatError(typed: string, blurred = false): boolean {
  const t = typed.trim()
  if (t === '' || normalizeReferralCode(t)) return false
  return blurred || t.length >= REFERRAL_CODE_MIN_LENGTH || /[^A-Za-z0-9]/.test(t)
}
