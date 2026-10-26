import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { isNextRedirectError } from '@/lib/api-error'
import {
  verifyOAuthState,
  exchangeCodeForTokens,
  generateFeedToken,
  registerWebhookChannel, reportCalendarFailure } from '@/lib/google-calendar'
import { upsertConnection, updateConnection } from '@/db/queries/calendar'
import { runInitialSync } from '@/lib/google-calendar-pull'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const code = searchParams.get('code')
    const state = searchParams.get('state')
    const error = searchParams.get('error')

    if (error) {
      return NextResponse.redirect(`${APP_URL}/configuracoes?calendar=denied`)
    }

    if (!code || !state) {
      return NextResponse.redirect(`${APP_URL}/configuracoes?calendar=error`)
    }

    const payload = verifyOAuthState(state)
    if (!payload) {
      console.error('Invalid or expired OAuth state')
      return NextResponse.redirect(`${APP_URL}/configuracoes?calendar=error`)
    }

    // Otherwise a link minted in one clinic binds whoever clicks it into that clinic's calendar sync.
    const ctx = await getAuthContext().catch((err) => {
      if (isNextRedirectError(err)) return null
      throw err
    })
    const allowedRoles = payload.type === 'clinic' ? ['owner'] : ['owner', 'practitioner']
    if (!ctx || ctx.userId !== payload.userId || ctx.tenantId !== payload.tenantId || !allowedRoles.includes(ctx.role)) {
      return NextResponse.redirect(`${APP_URL}/configuracoes?calendar=error`)
    }

    const tokens = await exchangeCodeForTokens(code)
    if (!tokens.access_token || !tokens.refresh_token) {
      console.error('Missing tokens from Google OAuth exchange')
      return NextResponse.redirect(`${APP_URL}/configuracoes?calendar=error`)
    }

    const userId = payload.type === 'clinic' ? null : payload.userId
    const feedToken = generateFeedToken()

    const connection = await upsertConnection({
      tenantId: payload.tenantId,
      userId,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      tokenExpiresAt: new Date(tokens.expiry_date ?? Date.now() + 3600 * 1000),
      feedToken,
    })

    try {
      const channel = await registerWebhookChannel(connection.id, connection.calendarId)
      await updateConnection(connection.id, payload.tenantId, {
        channelId: channel.channelId,
        channelResourceId: channel.resourceId,
        channelExpiry: channel.expiration,
      })
    } catch (err) {
      reportCalendarFailure(err, 'register_channel', { connectionId: connection.id })
    }

    if (userId) {
      runInitialSync(connection.id).catch((err) => {
        reportCalendarFailure(err, 'initial_sync', { connectionId: connection.id })
      })
    }

    const redirectUrl =
      payload.type === 'clinic'
        ? `${APP_URL}/configuracoes?tab=agendamento&calendar=connected`
        : `${APP_URL}/agenda?calendar=connected`

    return NextResponse.redirect(redirectUrl)
  } catch (error) {
    // This one can't answer JSON, so it can't go through handleApiError: the
    // user is mid-OAuth and has to land back in the app. A clinic that cannot
    // connect its calendar produced no signal at all before this.
    //
    // Via reportCalendarFailure because `exchangeCodeForTokens` answers
    // `invalid_grant` for a reused or expired authorization code, which is
    // what the back button and a slow consent screen produce.
    reportCalendarFailure(error, 'callback')
    return NextResponse.redirect(`${APP_URL}/configuracoes?calendar=error`)
  }
}
