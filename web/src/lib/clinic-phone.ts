/** DDD plus an 8-digit landline; mobiles have 11. */
export const MIN_CLINIC_PHONE_DIGITS = 10

/** Error shown when onboarding is saved without a usable clinic phone. */
export const CLINIC_PHONE_REQUIRED_MESSAGE = 'Informe o telefone da clínica com DDD'

/**
 * Whether a clinic phone has enough digits to reach the clinic (the DDD
 * included). Onboarding requires it on the client and on the server.
 */
export function hasClinicPhone(phone: string | null | undefined): boolean {
  return (phone ?? '').replace(/\D/g, '').length >= MIN_CLINIC_PHONE_DIGITS
}
