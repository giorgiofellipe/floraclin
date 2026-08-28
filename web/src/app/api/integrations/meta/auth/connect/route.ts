import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { handleApiError } from '@/lib/api-error'
import { signOAuthState, buildAuthUrl } from '@/lib/meta/oauth'
import { getMetaConnectionRaw } from '@/db/queries/meta-connections'

export async function GET(request: Request) {
  try {
    const ctx = await requireRole('owner')
    const { searchParams } = new URL(request.url)
    const acknowledgementVersion = searchParams.get('acknowledgementVersion')

    // Enforced here too, not only in the settings UI: the OAuth flow must
    // carry the accepted text version through to the callback, which cannot
    // ask the user for anything mid-redirect.
    if (!acknowledgementVersion) {
      return NextResponse.json({ error: 'acknowledgementVersion é obrigatório.' }, { status: 400 })
    }

    // A clinic reconnecting an existing manual connection keeps its dataset
    // without retyping it; a first-time OAuth connect must pass it explicitly.
    const datasetId = searchParams.get('datasetId') ?? undefined
    const existing = datasetId ? null : await getMetaConnectionRaw(ctx.tenantId)
    const resolvedDatasetId = datasetId ?? existing?.datasetId

    if (!resolvedDatasetId) {
      return NextResponse.json({ error: 'datasetId é obrigatório.' }, { status: 400 })
    }

    const state = signOAuthState({
      userId: ctx.userId,
      tenantId: ctx.tenantId,
      acknowledgementVersion,
      datasetId: resolvedDatasetId,
    })

    return NextResponse.redirect(buildAuthUrl(state))
  } catch (error) {
    return handleApiError(error, request)
  }
}
