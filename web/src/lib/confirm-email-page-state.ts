import { CONFIRM_TOKEN_TTL_MS } from '@/lib/confirm-email'

export const CONFIRM_EMAIL_STATE_COOKIE = 'floraclin_confirm_email'
export const CONFIRM_EMAIL_STATE_PATH = '/confirm-email'

export interface ConfirmEmailPageState {
  email: string
  token?: string | null
}

export function serializeConfirmEmailPageState(state: ConfirmEmailPageState): string {
  return JSON.stringify({
    email: state.email,
    token: state.token ?? null,
  })
}

export function parseConfirmEmailPageState(value: string | undefined): ConfirmEmailPageState | null {
  if (!value) return null

  try {
    const parsed = JSON.parse(value) as Partial<ConfirmEmailPageState>
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
    path: CONFIRM_EMAIL_STATE_PATH,
    maxAge: CONFIRM_TOKEN_TTL_MS / 1000,
  }
}
