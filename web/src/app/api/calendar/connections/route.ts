import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { listConnections, getConnectionByUserId } from '@/db/queries/calendar'
import { handleApiError } from '@/lib/api-error'

export async function GET(request: Request) {
  try {
    const ctx = await getAuthContext()

    if (ctx.role === 'owner') {
      const data = await listConnections(ctx.tenantId)
      const safe = data.map((c) => ({
        id: c.id,
        userId: c.userId,
        provider: c.provider,
        calendarId: c.calendarId,
        feedToken: c.feedToken,
        enabled: c.enabled,
        channelExpiry: c.channelExpiry,
        createdAt: c.createdAt,
      }))
      return NextResponse.json({ data: safe })
    }

    if (ctx.role === 'practitioner') {
      const conn = await getConnectionByUserId(ctx.tenantId, ctx.userId)
      const data = conn
        ? [{
            id: conn.id,
            userId: conn.userId,
            provider: conn.provider,
            calendarId: conn.calendarId,
            feedToken: conn.feedToken,
            enabled: conn.enabled,
            channelExpiry: conn.channelExpiry,
            createdAt: conn.createdAt,
          }]
        : []
      return NextResponse.json({ data })
    }

    return NextResponse.json({ data: [] })
  } catch (error) {
    return handleApiError(error, request)
  }
}
