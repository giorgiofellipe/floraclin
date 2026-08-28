import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { handleApiError } from '@/lib/api-error'
import { getMetaConnectionRaw } from '@/db/queries/meta-connections'
import { META_GRAPH_VERSION } from '@/lib/meta/types'

interface GraphDataset {
  id: string
  name: string
}

interface GraphDatasetsResponse {
  data?: GraphDataset[]
  error?: { message?: string }
}

interface DatasetsRequestBody {
  businessId?: string
  accessToken?: string
}

/**
 * `/auth/connect` needs a datasetId before it can even start the OAuth
 * redirect (it goes into the signed state). This is what lets the settings
 * card resolve one first: list the business's pixels so the user can pick
 * one instead of typing a raw id blind. Pixel, not ad account, because
 * `capi-client.ts` posts to `/{datasetId}/events`, the pixel events
 * endpoint.
 *
 * POST rather than GET because the caller may hand us a token it has not
 * saved yet: Vercel and Sentry both log request URLs, so it travels in the
 * body inbound and in an Authorization header outbound.
 */
export async function POST(request: Request) {
  try {
    const ctx = await requireRole('owner')
    const body = (await request.json().catch(() => ({}))) as DatasetsRequestBody
    const businessId = body.businessId

    if (!businessId) {
      return NextResponse.json({ error: 'businessId é obrigatório.' }, { status: 400 })
    }

    let accessToken = body.accessToken ?? null
    if (!accessToken) {
      const connection = await getMetaConnectionRaw(ctx.tenantId)
      accessToken = connection?.accessToken ?? null
    }

    if (!accessToken) {
      return NextResponse.json(
        { error: 'Nenhum token disponível. Conecte-se ou informe um token de acesso.' },
        { status: 400 },
      )
    }

    const url = `https://graph.facebook.com/${META_GRAPH_VERSION}/${encodeURIComponent(businessId)}/adspixels?fields=id,name`

    const response = await fetch(url, {
      method: 'GET',
      // Without this a hung Meta socket hangs the settings page.
      signal: AbortSignal.timeout(10_000),
      headers: { authorization: `Bearer ${accessToken}` },
    })
    const graphBody = (await response.json().catch(() => ({}))) as GraphDatasetsResponse

    if (!response.ok) {
      return NextResponse.json(
        { error: graphBody.error?.message ?? `HTTP ${response.status}` },
        { status: 400 },
      )
    }

    const datasets = (graphBody.data ?? []).map((item) => ({ id: item.id, name: item.name }))
    return NextResponse.json({ data: datasets })
  } catch (error) {
    return handleApiError(error, request)
  }
}
