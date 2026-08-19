import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { getExpiringConnections, updateConnection } from '@/db/queries/calendar'
import { registerWebhookChannel, stopWebhookChannel } from '@/lib/google-calendar'
import { handleApiError } from '@/lib/api-error'

// Schedule mirrors `vercel.json`. Vercel evaluates cron expressions in UTC,
// so the monitor has to be told the same thing or Sentry marks every run late.
const MONITOR_SLUG = 'calendar-renew'
const MONITOR_CONFIG = {
  schedule: { type: 'crontab', value: '0 6 * * *' },
  timezone: 'Etc/UTC',
  checkinMargin: 60,
  maxRuntime: 10,
} as const

export async function GET(request: Request) {
  try {
    const authHeader = request.headers.get('authorization')
    const cronSecret = process.env.CRON_SECRET

    if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // A cron that stops being invoked is invisible: nothing throws, nothing
    // logs, Google's webhook channels just expire and calendar sync dies
    // silently a couple of days later. The check-in makes the absence itself
    // the alert.
    const result = await Sentry.withMonitor(
      MONITOR_SLUG,
      async () => {
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
            // Swallowed on purpose so one broken connection can't stop the
            // other clinics from renewing, but a swallowed error still has to
            // be seen: this used to be a `console.error` nobody reads, and a
            // connection that fails every night simply stops syncing.
            Sentry.captureException(error, {
              tags: { area: 'cron', cron: MONITOR_SLUG },
              extra: { connectionId: connection.id, tenantId: connection.tenantId },
            })
            failed++
          }
        }

        return { renewed, failed, total: connections.length }
      },
      MONITOR_CONFIG,
    )

    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    return handleApiError(error, request)
  }
}
