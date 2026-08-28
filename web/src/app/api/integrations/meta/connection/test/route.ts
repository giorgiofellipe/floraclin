import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { handleApiError } from '@/lib/api-error'
import { getMetaConnectionRaw, markConnectionVerified } from '@/db/queries/meta-connections'
import { postEvents } from '@/lib/meta/capi-client'

export async function POST(request: Request) {
  try {
    const ctx = await getAuthContext()
    const connection = await getMetaConnectionRaw(ctx.tenantId)

    if (!connection) {
      return NextResponse.json({ error: 'Nenhuma conexão configurada.' }, { status: 404 })
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
