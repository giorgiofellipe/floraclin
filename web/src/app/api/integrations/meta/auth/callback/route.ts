import { NextResponse } from 'next/server'
import { verifyOAuthState, exchangeCodeForLongLivedToken } from '@/lib/meta/oauth'
import { upsertMetaConnection, recordAcknowledgement } from '@/db/queries/meta-connections'
import { createAuditLog } from '@/lib/audit'
import { reportSideEffectFailure } from '@/lib/observability'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
const REDIRECT_BASE = `${APP_URL}/configuracoes?tab=integracoes`

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const code = searchParams.get('code')
    const state = searchParams.get('state')
    const error = searchParams.get('error')

    if (error) {
      return NextResponse.redirect(`${REDIRECT_BASE}&meta=denied`)
    }

    if (!code || !state) {
      return NextResponse.redirect(`${REDIRECT_BASE}&meta=error`)
    }

    const payload = verifyOAuthState(state)
    if (!payload || !payload.acknowledgementVersion || !payload.datasetId) {
      return NextResponse.redirect(`${REDIRECT_BASE}&meta=error`)
    }

    const { accessToken, expiresAt } = await exchangeCodeForLongLivedToken(code)

    const connection = await upsertMetaConnection(payload.tenantId, {
      datasetId: payload.datasetId,
      accessToken,
      connectionType: 'oauth',
      tokenExpiresAt: expiresAt,
    })

    await recordAcknowledgement(payload.tenantId, payload.userId, payload.acknowledgementVersion)
    await createAuditLog({
      tenantId: payload.tenantId,
      userId: payload.userId,
      action: 'consent_accepted',
      entityType: 'meta_connection',
      entityId: connection.id,
      changes: { acknowledgementVersion: { old: null, new: payload.acknowledgementVersion } },
    })

    return NextResponse.redirect(`${REDIRECT_BASE}&meta=connected`)
  } catch (error) {
    // This route can't answer JSON: the browser is mid-redirect and has to
    // land back in the app either way. `exchangeCodeForLongLivedToken`
    // throwing here is what a reused authorization code or a denied App
    // Review scope looks like.
    reportSideEffectFailure(error, { area: 'meta-integration', step: 'oauth_callback' })
    return NextResponse.redirect(`${REDIRECT_BASE}&meta=error`)
  }
}
