import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import {
  getTodayAppointments,
  getQuickStats,
  getUpcomingFollowUps,
  getRecentActivity,
} from '@/db/queries/dashboard'

export async function GET() {
  try {
    const ctx = await getAuthContext()

    // Practitioners see only their data, owners/others see all
    const practitionerId = ctx.role === 'practitioner' ? ctx.userId : undefined

    const [todayAppointments, quickStats, upcomingFollowUps, recentActivity] =
      await Promise.all([
        getTodayAppointments(ctx.tenantId, practitionerId).catch(() => []),
        getQuickStats(ctx.tenantId, practitionerId).catch(() => ({
          patientsThisWeek: 0,
          proceduresThisMonth: 0,
          revenueThisMonth: ctx.role === 'practitioner' ? null : 0,
        })),
        getUpcomingFollowUps(ctx.tenantId, practitionerId).catch(() => []),
        getRecentActivity(ctx.tenantId, 10).catch(() => []),
      ])

    return NextResponse.json({
      todayAppointments,
      quickStats,
      upcomingFollowUps,
      recentActivity,
    })
  } catch (error) {
    const msg = error instanceof Error ? error.message : ''
    if (msg.includes('Forbidden')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (msg.includes('NEXT_REDIRECT') || msg.includes('redirect')) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    console.error('API error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
