import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { handleApiError } from '@/lib/api-error'
import { getMetaConnectionRaw, markConnectionVerified } from '@/db/queries/meta-connections'
import { postEvents } from '@/lib/meta/capi-client'

// Owner-only like the rest of the connection routes: this fires a real
// Conversions API call on the clinic's stored token, so it is a write as far
// as Meta is concerned, not a read.
export async function POST(request: Request) {
  try {
    const ctx = await requireRole('owner')
    const connection = await getMetaConnectionRaw(ctx.tenantId)

    if (!connection) {
      return NextResponse.json({ error: 'Nenhuma conexão configurada.' }, { status: 404 })
    }
    if (!connection.datasetId) {
      return NextResponse.json({ error: 'Escolha um conjunto de dados antes de testar a conexão.' }, { status: 400 })
    }
    if (!connection.testEventCode) {
      return NextResponse.json({ error: 'Configure um código de teste antes de testar a conexão.' }, { status: 400 })
    }

    const result = await postEvents(
      {
        datasetId: connection.datasetId,
        accessToken: connection.accessToken,
        testEventCode: connection.testEventCode,
      },
      [
        {
          event_name: 'PageView',
          event_time: Math.floor(Date.now() / 1000),
          event_id: `test-${connection.id}-${Date.now()}`,
          action_source: 'website',
          user_data: {},
        },
      ],
    )

    if (result.ok) {
      await markConnectionVerified(ctx.tenantId)
    }

    return NextResponse.json(result)
  } catch (error) {
    return handleApiError(error, request)
  }
}
