/**
 * Shared helpers for Instagram conversation/message UI components.
 *
 * These helpers operate on the minimal shape required by each function so
 * they can be reused across the conversation list, chat panel and the
 * "start conversation" dialog without forcing every consumer onto the
 * same row type.
 */

interface InstagramProfileLike {
  igHandle: string | null
  igProfileName: string | null
}

/**
 * Build a 1–2 letter initial badge from the profile name or handle. Falls
 * back to "IG" if neither is available.
 */
export function getInitials(profile: InstagramProfileLike): string
export function getInitials(handle: string | null, profileName: string | null): string
export function getInitials(
  handleOrProfile: string | null | InstagramProfileLike,
  profileName?: string | null,
): string {
  let handle: string | null
  let name: string | null
  if (typeof handleOrProfile === 'object' && handleOrProfile !== null) {
    handle = handleOrProfile.igHandle
    name = handleOrProfile.igProfileName
  } else {
    handle = handleOrProfile
    name = profileName ?? null
  }
  const source = name ?? handle ?? ''
  if (!source) return 'IG'
  const parts = source.trim().split(/\s+/)
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
  }
  return source.slice(0, 2).toUpperCase()
}

/**
 * Human-friendly label for a conversation row. Prefers the @handle, then
 * the profile name, then a generic placeholder.
 */
export function displayLabel(profile: InstagramProfileLike): string {
  if (profile.igHandle) return `@${profile.igHandle}`
  if (profile.igProfileName) return profile.igProfileName
  return 'Usuário do Instagram'
}

/**
 * Alias of displayLabel — kept because some chat-panel callsites used
 * "displayHandle" semantically (header subtitle / etc.).
 */
export const displayHandle = displayLabel
