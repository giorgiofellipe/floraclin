import { REFERRAL_CODE_ALPHABET, REFERRAL_CODE_LENGTH } from './rules'

const LIMIT = 256 - (256 % REFERRAL_CODE_ALPHABET.length) // 248: bytes at or above it would bias the first chars

/** Rejection sampling over the alphabet (31 chars): bytes ≥ 248 are discarded so every char is uniform. */
export function generateReferralCode(
  randomBytes: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n)),
): string {
  let code = ''
  while (code.length < REFERRAL_CODE_LENGTH) {
    for (const byte of randomBytes(REFERRAL_CODE_LENGTH * 2)) {
      if (byte >= LIMIT) continue
      code += REFERRAL_CODE_ALPHABET[byte % REFERRAL_CODE_ALPHABET.length]
      if (code.length === REFERRAL_CODE_LENGTH) break
    }
  }
  return code
}
