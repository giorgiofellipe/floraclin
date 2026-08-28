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

/**
 * `/auth/connect` needs a datasetId before it can even start the OAuth
 * redirect (it goes into the signed state). This is what lets the settings
 * card resolve one first: list the business's pixels so the user can pick
 * one instead of typing a raw id blind. Pixel, not ad account, because
 * `capi-client.ts` posts to `/{datasetId}/events`, the pixel events
 * endpoint.
 */
export async function GET(request: Request) {
  try {
    const ctx = await requireRole('owner')
    const { searchParams } = new URL(request.url)
    const businessId = searchParams.get('businessId')
    const source = searchParams.get('source') === 'ad_accounts' ? 'owned_ad_accounts' : 'adspixels'

    if (!businessId) {
      return NextResponse.json({ error: 'businessId é obrigatório.' }, { status: 400 })
    }

    let accessToken = searchParams.get('accessToken')
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

    const url = new URL(`https://graph.facebook.com/${META_GRAPH_VERSION}/${businessId}/${source}`)
    url.searchParams.set('fields', 'id,name')
    url.searchParams.set('access_token', accessToken)

    const response = await fetch(url.toString())
    const body = (await response.json().catch(() => ({}))) as GraphDatasetsResponse

    if (!response.ok) {
      return NextResponse.json(
        { error: body.error?.message ?? `HTTP ${response.status}` },
        { status: 400 },
      )
    }

    const datasets = (body.data ?? []).map((item) => ({ id: item.id, name: item.name }))
    return NextResponse.json({ data: datasets })
  } catch (error) {
    return handleApiError(error, request)
  }
}
