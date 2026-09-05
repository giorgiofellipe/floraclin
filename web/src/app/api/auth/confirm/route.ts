import { NextRequest, NextResponse } from 'next/server'
import { consumeConfirmationToken } from '@/lib/confirm-email'
import { markEmailVerified } from '@/db/queries/users'
import { handleApiError } from '@/lib/api-error'

/**
 * GET renders, it does not consume.
 *
 * Corporate mail scanners and link-preview bots follow the URL in the
 * confirmation email before the recipient ever clicks it. If GET consumed
 * the token, it would already be spent in transit and the real user would
 * land on "link invalido ou expirado" for a link they never opened.
 *
 * So GET only forwards the email and token to the confirm-email page, which
 * renders a "Confirmar e-mail" button that POSTs them. Consumption only
 * happens from that explicit, human-initiated POST.
 */
export async function GET(request: NextRequest) {
  const email = request.nextUrl.searchParams.get('email')
  const token = request.nextUrl.searchParams.get('token')

  const target = request.nextUrl.clone()
  target.pathname = '/confirm-email'
  target.search = ''
  if (email) target.searchParams.set('email', email)
  if (token) target.searchParams.set('token', token)

  return NextResponse.redirect(target)
}

/**
 * POST consumes the token and marks the address verified.
 *
 * The caller's JWT (if it has one) still says emailVerified: false after
 * this succeeds -- refreshing that is the client's job, via useSession()'s
 * update() (see confirm-actions.tsx), not this route's.
 */
export async function POST(request: NextRequest) {
  try {
    const { email, token } = await request.json()

    if (!email || !token) {
      return NextResponse.json({ error: 'Dados incompletos' }, { status: 400 })
    }

    const verifiedEmail = await consumeConfirmationToken(email, token)
    if (!verifiedEmail) {
      return NextResponse.json({ error: 'Link inválido ou expirado' }, { status: 400 })
    }

    await markEmailVerified(verifiedEmail)

    return NextResponse.json({ success: true })
  } catch (error) {
    return handleApiError(error, request)
  }
}
