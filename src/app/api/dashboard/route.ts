import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import {
  getTodayAppointments,
  getQuickStats,
  getUpcomingFollowUps,
  getRecentActivity,
} from '@/db/queries/dashboard'

export async function GET(request: Request) {
  try {
    const ctx = await getAuthContext()
    const { searchParams } = new URL(request.url)

    const practitionerId = searchParams.get('practitionerId') ?? undefined

    const [appointments, stats, followUps, activity] = await Promise.all([
      getTodayAppointments(ctx.tenantId, practitionerId),
      getQuickStats(ctx.tenantId, practitionerId),
      getUpcomingFollowUps(ctx.tenantId, practitionerId),
      getRecentActivity(ctx.tenantId),
    ])

    return NextResponse.json({
      appointments,
      stats,
      followUps,
      activity,
    })
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
}
