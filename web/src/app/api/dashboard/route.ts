import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import {
  getTodayAppointments,
  getQuickStats,
  getUpcomingFollowUps,
  getRecentActivity,
  MONTH_PARAM_RE,
} from '@/db/queries/dashboard'
import { countPendingReschedule } from '@/db/queries/appointments'
import { brToday } from '@/lib/dates'
import { handleApiError } from '@/lib/api-error'

export async function GET(request: Request) {
  try {
    const ctx = await getAuthContext()

    const { searchParams } = new URL(request.url)
    const monthParam = searchParams.get('month')
    let month: string | undefined
    if (monthParam !== null) {
      if (!MONTH_PARAM_RE.test(monthParam)) {
        return NextResponse.json(
          { error: 'Mês inválido, use o formato YYYY-MM' },
          { status: 400 }
        )
      }
      if (monthParam > brToday().slice(0, 7)) {
        return NextResponse.json(
          { error: 'Não é possível selecionar um mês futuro' },
          { status: 400 }
        )
      }
      month = monthParam
    }

    // Practitioners see only their data, owners/others see all
    const practitionerId = ctx.role === 'practitioner' ? ctx.userId : undefined

    const [todayAppointments, quickStats, upcomingFollowUps, recentActivity, pendingRescheduleCount] =
      await Promise.all([
        getTodayAppointments(ctx.tenantId, practitionerId).catch(() => []),
        getQuickStats(ctx.tenantId, practitionerId, month).catch(() => ({
          patientsThisWeek: 0,
          proceduresThisMonth: 0,
          revenueThisMonth: ctx.role === 'practitioner' ? null : 0,
          totalPending: ctx.role === 'practitioner' ? null : 0,
          totalExpenses: ctx.role === 'practitioner' ? null : 0,
          totalOverdue: ctx.role === 'practitioner' ? null : 0,
        })),
        getUpcomingFollowUps(ctx.tenantId, practitionerId).catch(() => []),
        getRecentActivity(ctx.tenantId, 10).catch(() => []),
        countPendingReschedule(ctx.tenantId, practitionerId).catch(() => 0),
      ])

    return NextResponse.json({
      todayAppointments,
      quickStats,
      upcomingFollowUps,
      recentActivity,
      pendingRescheduleCount,
    })
  } catch (error) {
    return handleApiError(error, request)
  }
}
