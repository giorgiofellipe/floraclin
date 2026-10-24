import { loginMethodFromProvider } from '@/lib/analytics/events'

export const LAST_LOGIN_METHOD_COOKIE = 'floraclin_last_login'
const MAX_AGE_SECONDS = 365 * 24 * 60 * 60

/** The login page options a badge can sit on. A magic link has no button there, so it counts as e-mail. */
export type LastLoginOption = 'google' | 'email'

export function lastLoginOptionForProvider(provider: string): LastLoginOption | null {
  const method = loginMethodFromProvider(provider)
  if (!method) return null
  return method === 'google' ? 'google' : 'email'
}

export function parseLastLoginOption(value: string | undefined): LastLoginOption | null {
  return value === 'google' || value === 'email' ? value : null
}

export const lastLoginCookieOptions = {
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
  path: '/',
  maxAge: MAX_AGE_SECONDS,
} as const
