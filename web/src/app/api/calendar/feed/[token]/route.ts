import { NextResponse } from 'next/server'
import { getConnectionByFeedToken } from '@/db/queries/calendar'
import { generateICalFeed } from '@/lib/ical-feed'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params

    const feedToken = token.replace(/\.ics$/, '')

    const connection = await getConnectionByFeedToken(feedToken)
    if (!connection || !connection.enabled) {
      return new NextResponse('Not Found', { status: 404 })
    }

    const calendarName = connection.userId
      ? 'FloraClin - Meus Agendamentos'
      : 'FloraClin - Clínica'

    const icalContent = await generateICalFeed(
      connection.tenantId,
      connection.userId,
      calendarName
    )

    return new NextResponse(icalContent, {
      status: 200,
      headers: {
        'Content-Type': 'text/calendar; charset=utf-8',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Content-Disposition': 'inline; filename="floraclin.ics"',
      },
    })
  } catch (error) {
    console.error('iCal feed error:', error)
    return new NextResponse('Internal Server Error', { status: 500 })
  }
}
