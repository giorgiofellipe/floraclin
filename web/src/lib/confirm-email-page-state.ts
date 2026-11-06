/**
 * A password reset gets 1 hour because the user is actively waiting on
 * it right after clicking "forgot password". A confirmation link is
 * first contact after signup and is often read the next morning, not
 * within minutes, so it gets a longer window.
 */
export const CONFIRM_TOKEN_TTL_MS = 24 * 60 * 60 * 1000

export const CONFIRM_EMAIL_STATE_COOKIE = 'floraclin_confirm_email'
export const CONFIRM_EMAIL_STATE_PATH = '/confirm-email'

export interface ConfirmEmailPageState {
  email: string
  token?: string | null
  /** The link was refused because the address is confirmed already (opened again, say on another device). */
  confirmed?: true
}

export function serializeConfirmEmailPageState(state: ConfirmEmailPageState): string {
  return JSON.stringify({
    email: state.email,
    token: state.token ?? null,
    ...(state.confirmed ? { confirmed: true } : {}),
  })
}

export function parseConfirmEmailPageState(value: string | undefined): ConfirmEmailPageState | null {
  if (!value) return null

  try {
    const parsed = JSON.parse(value) as Partial<ConfirmEmailPageState>
    const email = typeof parsed.email === 'string' ? parsed.email.trim() : ''
    const token = typeof parsed.token === 'string' && parsed.token.trim() ? parsed.token.trim() : null
    if (!email) return null
    return parsed.confirmed === true ? { email, token, confirmed: true } : { email, token }
  } catch {
    return null
  }
}

export function confirmEmailStateCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: CONFIRM_EMAIL_STATE_PATH,
    maxAge: CONFIRM_TOKEN_TTL_MS / 1000,
  }
}
