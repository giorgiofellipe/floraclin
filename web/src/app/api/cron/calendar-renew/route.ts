import { NextResponse } from 'next/server'
import { getExpiringConnections, updateConnection } from '@/db/queries/calendar'
import { registerWebhookChannel, stopWebhookChannel } from '@/lib/google-calendar'

export async function GET(request: Request) {
  try {
    const authHeader = request.headers.get('authorization')
    const cronSecret = process.env.CRON_SECRET

    if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const connections = await getExpiringConnections(48)
    let renewed = 0
    let failed = 0

    for (const connection of connections) {
      try {
        if (connection.channelId && connection.channelResourceId) {
          await stopWebhookChannel(
            connection.id,
            connection.channelId,
            connection.channelResourceId
          )
        }

        const channel = await registerWebhookChannel(
          connection.id,
          connection.calendarId
        )

        await updateConnection(connection.id, connection.tenantId, {
          channelId: channel.channelId,
          channelResourceId: channel.resourceId,
          channelExpiry: channel.expiration,
        })

        renewed++
      } catch (error) {
        console.error(`Failed to renew channel for connection ${connection.id}:`, error)
        failed++
      }
    }

    return NextResponse.json({
      ok: true,
      renewed,
      failed,
      total: connections.length,
    })
  } catch (error) {
    console.error('Calendar renew cron error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
