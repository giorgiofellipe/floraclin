import { cookies } from 'next/headers'

const LAST_LOGIN_COOKIE = 'floraclin_last_login'
const MAX_AGE_SECONDS = 365 * 24 * 60 * 60

/** The login page options a badge can sit on. */
export type LastLoginOption = 'google' | 'email'

// A magic link has no button on the login page, so it leaves the remembered option alone.
const OPTION_BY_PROVIDER: Partial<Record<string, LastLoginOption>> = {
  google: 'google',
  credentials: 'email',
  'confirm-email': 'email',
}

export async function rememberLastLogin(provider: string | undefined): Promise<void> {
  const option = provider ? OPTION_BY_PROVIDER[provider] : undefined
  if (!option) return
  ;(await cookies()).set(LAST_LOGIN_COOKIE, option, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/login',
    maxAge: MAX_AGE_SECONDS,
  })
}

export async function readLastLogin(): Promise<LastLoginOption | null> {
  const value = (await cookies()).get(LAST_LOGIN_COOKIE)?.value
  return value === 'google' || value === 'email' ? value : null
}
