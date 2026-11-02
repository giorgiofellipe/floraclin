import { NextRequest, NextResponse } from 'next/server'
import { redirect } from 'next/navigation'
import { CredentialsSignin } from 'next-auth'
import { auth, signIn } from '@/lib/auth-config'
import { isUserEmailVerified } from '@/db/queries/users'
import { isNextRedirectError } from '@/lib/api-error'
import { reportSideEffectFailure } from '@/lib/observability'
import {
  CONFIRM_EMAIL_STATE_COOKIE,
  confirmEmailStateCookieOptions,
  serializeConfirmEmailPageState,
} from '@/lib/confirm-email-page-state'

/** Where a confirmed owner goes; /onboarding sends a finished clinic on to the dashboard. */
const AFTER_CONFIRM_PATH = '/onboarding'

/**
 * A GET from a stranger renders, it does not consume.
 *
 * Corporate mail scanners and link-preview bots follow the URL in the
 * confirmation email before the recipient ever clicks it. If such a GET
 * consumed the token, it would already be spent in transit and the real user
 * would land on "link invalido ou expirado" for a link they never opened. So
 * without a session the email and token go to the confirm-email page in a
 * cookie, and its "Confirmar e-mail" button signs in with them
 * (actions/confirm-email.ts).
 *
 * A GET carrying the session of the very address in the link is the owner
 * clicking it in the browser they signed up in (signup signs them in): no
 * scanner holds that cookie. That click confirms and goes straight on to
 * onboarding. It used to stop on the confirm-email page as well, which looks
 * like the "check your inbox" screen they had just left, so people took it
 * for a failed link and signed in by hand.
 */
export async function GET(request: NextRequest) {
  const email = request.nextUrl.searchParams.get('email')
  const token = request.nextUrl.searchParams.get('token')

  if (email && token) {
    const session = await auth()
    const sessionEmail = session?.user?.email?.toLowerCase()
    if (session?.user?.id && sessionEmail === email.toLowerCase()) {
      await confirmSignedInOwner(session.user.id, email, token)
    }
  }

  const target = request.nextUrl.clone()
  target.pathname = '/confirm-email'
  target.search = ''

  const response = NextResponse.redirect(target)
  if (email) {
    response.cookies.set(
      CONFIRM_EMAIL_STATE_COOKIE,
      serializeConfirmEmailPageState({ email, token }),
      confirmEmailStateCookieOptions(),
    )
  }

  return response
}

/**
 * Redirects (throws Next's redirect) once the address is confirmed and the
 * session reissued with it; returns to fall back to the confirm-email page.
 */
async function confirmSignedInOwner(userId: string, email: string, token: string): Promise<void> {
  try {
    // Signing in again reissues the JWT, so the claims match the confirmed
    // address, and fires the confirm-email provider's side effects once.
    await signIn('confirm-email', { email, token, redirectTo: AFTER_CONFIRM_PATH })
  } catch (error) {
    if (isNextRedirectError(error)) throw error
    if (!(error instanceof CredentialsSignin)) {
      reportSideEffectFailure(error, { area: 'signup', step: 'confirm_link_signed_in' })
      return
    }
  }

  // The token was refused. A second click on a link already used, by this
  // same owner, is not an error: they are confirmed and signed in.
  if (await isUserEmailVerified(userId)) redirect(AFTER_CONFIRM_PATH)
}
