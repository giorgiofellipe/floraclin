/** Longest first name carried into the stand-in, so the name stays readable. */
const MAX_FIRST_NAME_LENGTH = 60

/**
 * Settings key marking a clinic created automatically after Google sign-up,
 * whose name is only a stand-in built from the owner's name. Onboarding asks
 * for the real name (starting from an empty field) and clears it.
 */
export const PLACEHOLDER_NAME_SETTING = 'clinic_name_placeholder'

/** Whether the clinic still carries the stand-in name from Google sign-up. */
export function hasPlaceholderName(settings: unknown): boolean {
  return ((settings as Record<string, unknown> | null | undefined) ?? {})[PLACEHOLDER_NAME_SETTING] === true
}

/**
 * Stand-in name for a clinic created right after Google sign-up, before the
 * owner has told us what it is called. Onboarding replaces it.
 */
export function placeholderClinicName(ownerName: string | null | undefined): string {
  // By code point, so a cut never splits an emoji or other astral character.
  const firstName = Array.from(ownerName?.trim().split(/\s+/)[0] ?? '').slice(0, MAX_FIRST_NAME_LENGTH).join('')
  return firstName ? `Clínica de ${firstName}` : 'Minha clínica'
}

/**
 * Platform admins are never given a clinic on arrival. The clinic-details page
 * (which starts the automatic creation) and the server action (which refuses
 * it) must agree on this, so both read it here.
 */
export function isPlatformAdminSession(session: unknown): boolean {
  return (session as { isPlatformAdmin?: boolean } | null | undefined)?.isPlatformAdmin === true
}
