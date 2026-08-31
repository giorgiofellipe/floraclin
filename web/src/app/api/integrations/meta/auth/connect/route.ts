import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { handleApiError } from '@/lib/api-error'
import {
  signOAuthState,
  buildAuthUrl,
  createOAuthCsrfToken,
  setOAuthCsrfCookie,
} from '@/lib/meta/oauth'
import { ACKNOWLEDGEMENT_VERSION } from '@/lib/meta/acknowledgement'

/**
 * Leg 1 of two: authorize only. The dataset cannot be asked for here, because
 * listing a clinic's datasets needs the very token this redirect goes out to
 * fetch. The callback parks the connection as `pending_dataset` and the
 * settings card runs leg 2.
 */
export async function GET(request: Request) {
  try {
    const ctx = await requireRole('owner')
    const { searchParams } = new URL(request.url)
    const acknowledgementVersion = searchParams.get('acknowledgementVersion')

    // Compared to the constant, not merely required: the version travels in
    // the signed state into the callback and ends up in audit_logs as the
    // evidence of which text the owner accepted. Any other string proves
    // nothing.
    if (acknowledgementVersion !== ACKNOWLEDGEMENT_VERSION) {
      return NextResponse.json({ error: 'acknowledgementVersion inválido.' }, { status: 400 })
    }

    // Only the digest goes into the state; the token itself stays in the
    // cookie, so a captured state cannot be completed from another browser.
    const { token, hash } = createOAuthCsrfToken()

    const state = signOAuthState({
      userId: ctx.userId,
      tenantId: ctx.tenantId,
      acknowledgementVersion,
      csrfHash: hash,
    })

    const response = NextResponse.redirect(buildAuthUrl(state))
    setOAuthCsrfCookie(response, token)
    return response
  } catch (error) {
    return handleApiError(error, request)
  }
}
