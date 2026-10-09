export const CONFIRM_EMAIL_STATE_COOKIE = 'floraclin_confirm_email'
export const CONFIRM_EMAIL_STATE_MAX_AGE_SECONDS = 15 * 60

export interface ConfirmEmailPageState {
  email: string
  token?: string | null
}

export function serializeConfirmEmailPageState(state: ConfirmEmailPageState): string {
  return encodeURIComponent(JSON.stringify({
    email: state.email,
    token: state.token ?? null,
  }))
}

export function parseConfirmEmailPageState(value: string | undefined): ConfirmEmailPageState | null {
  if (!value) return null

  try {
    const parsed = JSON.parse(decodeURIComponent(value)) as Partial<ConfirmEmailPageState>
    const email = typeof parsed.email === 'string' ? parsed.email.trim() : ''
    const token = typeof parsed.token === 'string' && parsed.token.trim() ? parsed.token.trim() : null
    return email ? { email, token } : null
  } catch {
    return null
  }
}

export function confirmEmailStateCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/confirm-email',
    maxAge: CONFIRM_EMAIL_STATE_MAX_AGE_SECONDS,
  }
}
