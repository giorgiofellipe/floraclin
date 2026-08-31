import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { handleApiError } from '@/lib/api-error'
import { getMetaConnectionRaw } from '@/db/queries/meta-connections'
import { META_GRAPH_VERSION } from '@/lib/meta/types'
import { fetchGraphList, GRAPH_PAGE_SIZE } from '@/lib/meta/graph-paging'

interface GraphBusiness {
  id: string
  name: string
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

    const url = `https://graph.facebook.com/${META_GRAPH_VERSION}/me/businesses?fields=id,name&limit=${GRAPH_PAGE_SIZE}`

    const result = await fetchGraphList<GraphBusiness>(url, accessToken)

    if (!result.ok) {
      return NextResponse.json({ error: result.message }, { status: 400 })
    }

    const businesses = result.items.map((item) => ({ id: item.id, name: item.name }))
    return NextResponse.json({ data: businesses, truncated: result.truncated })
  } catch (error) {
    return handleApiError(error, request)
  }
}
