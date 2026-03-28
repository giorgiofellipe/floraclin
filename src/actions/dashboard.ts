'use server'

import { getAuthContext } from '@/lib/auth'
import {
  getTodayAppointments,
  getQuickStats,
  getUpcomingFollowUps,
  getRecentActivity,
} from '@/db/queries/dashboard'
import type {
  TodayAppointment,
  QuickStats,
  UpcomingFollowUp,
  RecentActivityEntry,
} from '@/db/queries/dashboard'

export interface DashboardData {
  todayAppointments: TodayAppointment[]
  quickStats: QuickStats
  upcomingFollowUps: UpcomingFollowUp[]
  recentActivity: RecentActivityEntry[]
}

export async function getDashboardDataAction(): Promise<DashboardData> {
  const context = await getAuthContext()

  // Role-aware: practitioners see only their data, owners/others see all
  const practitionerId =
    context.role === 'practitioner' ? context.userId : undefined

  const [todayAppointments, quickStats, upcomingFollowUps, recentActivity] =
    await Promise.all([
      getTodayAppointments(context.tenantId, practitionerId).catch(() => []),
      getQuickStats(context.tenantId, practitionerId).catch(() => ({
        patientsThisWeek: 0,
        proceduresThisMonth: 0,
        revenueThisMonth: context.role === 'practitioner' ? null : 0,
      })),
      getUpcomingFollowUps(context.tenantId, practitionerId).catch(() => []),
      getRecentActivity(context.tenantId, 10).catch(() => []),
    ])

  return {
    todayAppointments,
    quickStats,
    upcomingFollowUps,
    recentActivity,
  }
}
