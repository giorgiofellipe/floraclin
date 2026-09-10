import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import {
  verifyOAuthState,
  exchangeCodeForLongLivedToken,
  readOAuthCsrfCookie,
  csrfTokenMatchesHash,
  clearOAuthCsrfCookie,
} from '@/lib/meta/oauth'
import { upsertMetaConnection, recordAcknowledgement } from '@/db/queries/meta-connections'
import { createAuditLog } from '@/lib/audit'
import { reportSideEffectFailure } from '@/lib/observability'
import { ACKNOWLEDGEMENT_VERSION } from '@/lib/meta/acknowledgement'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
const REDIRECT_BASE = `${APP_URL}/configuracoes?tab=integracoes`

// Every exit clears the cookie, which is what makes it single use: one
// authorization per token, so a replayed callback finds nothing to match.
function finish(outcome: 'choose_dataset' | 'denied' | 'error'): NextResponse {
  const response = NextResponse.redirect(`${REDIRECT_BASE}&meta=${outcome}`)
  clearOAuthCsrfCookie(response)
  return response
}

// `getAuthContext` throws a redirect, which this route cannot follow.
async function ownerSession() {
  try {
    return await requireRole('owner')
  } catch {
    return null
  }
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const code = searchParams.get('code')
    const state = searchParams.get('state')
    const error = searchParams.get('error')

    if (error) {
      return finish('denied')
    }

    if (!code || !state) {
      return finish('error')
    }

    // Identity comes from the live session, never from the signed state.
    const ctx = await ownerSession()
    if (!ctx) {
      return finish('error')
    }

    const payload = verifyOAuthState(state)
    if (!payload) {
      return finish('error')
    }

    if (payload.acknowledgementVersion !== ACKNOWLEDGEMENT_VERSION) {
      return finish('error')
    }

    const csrfToken = readOAuthCsrfCookie(request)
    if (!csrfToken || !csrfTokenMatchesHash(csrfToken, payload.csrfHash)) {
      return finish('error')
    }

    if (payload.tenantId !== ctx.tenantId || payload.userId !== ctx.userId) {
      reportSideEffectFailure(
        new Error('Meta OAuth state belongs to another user or clinic than the current session'),
        { area: 'meta-integration', step: 'oauth_callback_state_mismatch' },
      )
      return finish('error')
    }

    const { accessToken, expiresAt } = await exchangeCodeForLongLivedToken(code)

    // Leg 1 ends here: the token exists, the dataset does not. The row is
    // parked as `pending_dataset` so `getMetaConnection` reads it as no
    // connection until the owner picks one.
    const connection = await upsertMetaConnection(ctx.tenantId, {
      datasetId: null,
      accessToken,
      connectionType: 'oauth',
      status: 'pending_dataset',
      tokenExpiresAt: expiresAt,
    })

    // The server constant, not the state's copy: the state is only allowed to
    // disagree by being rejected above, never by deciding what gets audited.
    await recordAcknowledgement(ctx.tenantId, ctx.userId, ACKNOWLEDGEMENT_VERSION)
    await createAuditLog({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'consent_accepted',
      entityType: 'meta_connection',
      entityId: connection.id,
      changes: { acknowledgementVersion: { old: null, new: ACKNOWLEDGEMENT_VERSION } },
    })

    return finish('choose_dataset')
  } catch (error) {
    // This route can't answer JSON: the browser is mid-redirect and has to
    // land back in the app either way. `exchangeCodeForLongLivedToken`
    // throwing here is what a reused authorization code or a denied App
    // Review scope looks like.
    reportSideEffectFailure(error, { area: 'meta-integration', step: 'oauth_callback' })
    return finish('error')
  }
}
