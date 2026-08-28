import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { handleApiError } from '@/lib/api-error'
import { signOAuthState, buildAuthUrl } from '@/lib/meta/oauth'
import { getMetaConnectionRaw } from '@/db/queries/meta-connections'
import { ACKNOWLEDGEMENT_VERSION } from '@/lib/meta/acknowledgement'

const MAX_DATASET_ID_LENGTH = 64

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

    // A clinic reconnecting an existing manual connection keeps its dataset
    // without retyping it; a first-time OAuth connect must pass it explicitly.
    const datasetId = searchParams.get('datasetId') ?? undefined
    const existing = datasetId ? null : await getMetaConnectionRaw(ctx.tenantId)
    const resolvedDatasetId = datasetId ?? existing?.datasetId

    if (!resolvedDatasetId || resolvedDatasetId.length > MAX_DATASET_ID_LENGTH) {
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
