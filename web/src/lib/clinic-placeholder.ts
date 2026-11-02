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
 * Settings key marking a booking slug made from the stand-in name. Unlike
 * PLACEHOLDER_NAME_SETTING, autosave leaves it alone (it clears the name flag
 * as soon as a real name is typed), so the onboarding save still knows to
 * replace the slug with one from the real name, and clears it then.
 */
export const PLACEHOLDER_SLUG_SETTING = 'clinic_slug_placeholder'

/** Whether the clinic's booking slug was made from the Google sign-up stand-in name. */
export function hasPlaceholderSlug(settings: unknown): boolean {
  return ((settings as Record<string, unknown> | null | undefined) ?? {})[PLACEHOLDER_SLUG_SETTING] === true
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

/** Longest suggestion, the clinic name column's limit. */
const MAX_SUGGESTED_NAME_LENGTH = 255

/**
 * What onboarding prefills as the clinic name after a Google sign-up, while
 * the clinic still carries the stand-in: "Clínica" and the owner's name from
 * the Google profile ("Clínica Ana Souza"). Many aesthetics clinics carry the
 * professional's name, and an editable suggestion beats an empty required
 * field on a phone. Empty when the profile has no real name: the adapter
 * falls back to the e-mail's local part ("ana.souza93"), which would make a
 * poor clinic name.
 */
export function suggestedClinicName(ownerName: string | null | undefined, ownerEmail: string | null | undefined): string {
  const name = ownerName?.trim().replace(/\s+/g, ' ') ?? ''
  if (!name || !/\p{L}/u.test(name)) return ''
  const localPart = ownerEmail?.split('@')[0]?.toLowerCase()
  if (localPart && name.toLowerCase() === localPart) return ''
  return Array.from(`Clínica ${name}`).slice(0, MAX_SUGGESTED_NAME_LENGTH).join('')
}
