'use server'

import { cookies } from 'next/headers'
import { AuthError, CredentialsSignin } from 'next-auth'
import { signIn } from '@/lib/auth-config'
import {
  CONFIRM_EMAIL_STATE_COOKIE,
  CONFIRM_EMAIL_STATE_PATH,
  confirmEmailStateCookieOptions,
  parseConfirmEmailPageState,
  serializeConfirmEmailPageState,
} from '@/lib/confirm-email-page-state'

export type ConfirmEmailResult = { error: string } | null

const INVALID_LINK = 'Link inválido ou expirado.'

export async function confirmEmail(): Promise<ConfirmEmailResult> {
  const cookieStore = await cookies()
  const state = parseConfirmEmailPageState(cookieStore.get(CONFIRM_EMAIL_STATE_COOKIE)?.value)
  if (!state?.token) return { error: INVALID_LINK }

  try {
    cookieStore.delete({ name: CONFIRM_EMAIL_STATE_COOKIE, path: CONFIRM_EMAIL_STATE_PATH })
    await signIn('confirm-email', { email: state.email, token: state.token, redirectTo: '/onboarding' })
    return null
  } catch (error) {
    if (error instanceof CredentialsSignin) {
      // Drop only the dead token: keeping the address leaves the resend button
      // on the page instead of the "type your e-mail" form.
      cookieStore.set(CONFIRM_EMAIL_STATE_COOKIE, serializeConfirmEmailPageState({ email: state.email }), confirmEmailStateCookieOptions())
      return { error: INVALID_LINK }
    }
    if (error instanceof AuthError) {
      // Auth.js wraps anything authorize throws (a database outage), and the
      // token may still be good, so it stays for another try.
      cookieStore.set(CONFIRM_EMAIL_STATE_COOKIE, serializeConfirmEmailPageState(state), confirmEmailStateCookieOptions())
      return { error: 'Não foi possível confirmar agora. Tente novamente.' }
    }
    throw error // Re-throw non-auth errors (like redirect)
  }
}
