import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { handleApiError } from '@/lib/api-error'
import { getMetaConnectionRaw } from '@/db/queries/meta-connections'
import { META_GRAPH_VERSION } from '@/lib/meta/types'
import { fetchGraphList, GRAPH_PAGE_SIZE } from '@/lib/meta/graph-paging'

interface GraphDataset {
  id: string
  name: string
}

interface DatasetsRequestBody {
  businessId?: string
  accessToken?: string
}

/**
 * Lists a business portfolio's pixels so the owner can pick one instead of
 * typing a raw id blind, both in leg 2 of the OAuth flow and in the manual
 * path. Pixel, not ad account, because `capi-client.ts` posts to
 * `/{datasetId}/events`, the pixel events endpoint.
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
      // Raw, not the status-filtered getter: leg 2 runs against a
      // `pending_dataset` connection, which is what holds the token here.
      const connection = await getMetaConnectionRaw(ctx.tenantId)
      accessToken = connection?.accessToken ?? null
    }

    if (!accessToken) {
      return NextResponse.json(
        { error: 'Nenhum token disponível. Conecte-se ou informe um token de acesso.' },
        { status: 400 },
      )
    }

    const url = `https://graph.facebook.com/${META_GRAPH_VERSION}/${encodeURIComponent(businessId)}/adspixels?fields=id,name&limit=${GRAPH_PAGE_SIZE}`

    const result = await fetchGraphList<GraphDataset>(url, accessToken)

    if (!result.ok) {
      return NextResponse.json({ error: result.message }, { status: 400 })
    }

    const datasets = result.items.map((item) => ({ id: item.id, name: item.name }))
    return NextResponse.json({ data: datasets, truncated: result.truncated })
  } catch (error) {
    return handleApiError(error, request)
  }
}
