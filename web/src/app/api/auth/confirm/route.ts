import { NextRequest, NextResponse } from 'next/server'
import {
  CONFIRM_EMAIL_STATE_COOKIE,
  confirmEmailStateCookieOptions,
  serializeConfirmEmailPageState,
} from '@/lib/confirm-email-page-state'

/**
 * GET renders, it does not consume.
 *
 * Corporate mail scanners and link-preview bots follow the URL in the
 * confirmation email before the recipient ever clicks it. If GET consumed
 * the token, it would already be spent in transit and the real user would
 * land on "link invalido ou expirado" for a link they never opened.
 *
 * So GET only hands the email and token to the confirm-email page in a
 * cookie, and the page renders a "Confirmar e-mail" button that signs in
 * with them (actions/confirm-email.ts). Consumption only happens from that
 * explicit, human-initiated click.
 */
export async function GET(request: NextRequest) {
  const email = request.nextUrl.searchParams.get('email')
  const token = request.nextUrl.searchParams.get('token')

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
