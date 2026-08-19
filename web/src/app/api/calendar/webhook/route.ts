import { NextResponse } from 'next/server'
import { getConnectionByChannelId } from '@/db/queries/calendar'
import { incrementalSync } from '@/lib/google-calendar-pull'
import { handleApiError } from '@/lib/api-error'
import { reportCalendarFailure } from '@/lib/google-calendar'

export async function POST(request: Request) {
  try {
    const channelId = request.headers.get('x-goog-channel-id')
    const resourceId = request.headers.get('x-goog-resource-id')
    const resourceState = request.headers.get('x-goog-resource-state')

    if (!channelId || !resourceId) {
      return NextResponse.json({ error: 'Missing channel headers' }, { status: 400 })
    }

    if (resourceState === 'sync') {
      return NextResponse.json({ ok: true })
    }

    const connection = await getConnectionByChannelId(channelId)
    if (!connection) {
      console.warn(`Webhook received for unknown channel: ${channelId}`)
      return NextResponse.json({ error: 'Unknown channel' }, { status: 404 })
    }

    if (connection.channelResourceId !== resourceId) {
      console.warn(`Webhook resource ID mismatch: expected ${connection.channelResourceId}, got ${resourceId}`)
      return NextResponse.json({ error: 'Resource ID mismatch' }, { status: 403 })
    }

    if (!connection.enabled) {
      return NextResponse.json({ ok: true, message: 'Connection disabled' })
    }

    incrementalSync(connection.id).catch((err) => {
      reportCalendarFailure(err, 'incremental_sync', { connectionId: connection.id })
    })

    return NextResponse.json({ ok: true })
  } catch (error) {
    return handleApiError(error, request)
  }
}
