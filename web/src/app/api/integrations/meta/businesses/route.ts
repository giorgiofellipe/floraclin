import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { handleApiError } from '@/lib/api-error'
import { getMetaConnectionRaw } from '@/db/queries/meta-connections'
import { META_GRAPH_VERSION } from '@/lib/meta/types'

interface GraphBusiness {
  id: string
  name: string
}

interface GraphBusinessesResponse {
  data?: GraphBusiness[]
  error?: { message?: string }
}

/**
 * Leg 2 of the OAuth flow starts here: the owner picks a business portfolio,
 * then a dataset inside it. Reads the stored token, so it works on a
 * `pending_dataset` connection, which is the only state that needs it.
 */
export async function GET(request: Request) {
  try {
    const ctx = await requireRole('owner')

    // Raw, not the status-filtered getter: a `pending_dataset` connection is
    // exactly the caller this route serves.
    const connection = await getMetaConnectionRaw(ctx.tenantId)
    const accessToken = connection?.accessToken ?? null

    if (!accessToken) {
      return NextResponse.json(
        { error: 'Nenhum token disponível. Conecte-se à Meta primeiro.' },
        { status: 400 },
      )
    }

    const url = `https://graph.facebook.com/${META_GRAPH_VERSION}/me/businesses?fields=id,name`

    const response = await fetch(url, {
      method: 'GET',
      // Without this a hung Meta socket hangs the settings page.
      signal: AbortSignal.timeout(10_000),
      // Never in the URL: Vercel and Sentry both log request URLs.
      headers: { authorization: `Bearer ${accessToken}` },
    })
    const graphBody = (await response.json().catch(() => ({}))) as GraphBusinessesResponse

    if (!response.ok) {
      return NextResponse.json(
        { error: graphBody.error?.message ?? `HTTP ${response.status}` },
        { status: 400 },
      )
    }

    const businesses = (graphBody.data ?? []).map((item) => ({ id: item.id, name: item.name }))
    return NextResponse.json({ data: businesses })
  } catch (error) {
    return handleApiError(error, request)
  }
}
