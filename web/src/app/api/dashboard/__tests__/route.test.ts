import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth', () => ({
  getAuthContext: vi.fn(),
}))

vi.mock('@/db/queries/dashboard', () => ({
  getTodayAppointments: vi.fn(),
  getQuickStats: vi.fn(),
  getUpcomingFollowUps: vi.fn(),
  getRecentActivity: vi.fn(),
  MONTH_PARAM_RE: /^\d{4}-(0[1-9]|1[0-2])$/,
}))

vi.mock('@/db/queries/appointments', () => ({
  countPendingReschedule: vi.fn(),
}))

import { getAuthContext } from '@/lib/auth'
import {
  getTodayAppointments,
  getQuickStats,
  getUpcomingFollowUps,
  getRecentActivity,
} from '@/db/queries/dashboard'
import { countPendingReschedule } from '@/db/queries/appointments'
import { GET } from '../route'

function makeRequest(url: string) {
  return new Request(url)
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getAuthContext).mockResolvedValue({
    tenantId: 'tenant-1',
    userId: 'user-1',
    role: 'owner',
  } as never)
  vi.mocked(getTodayAppointments).mockResolvedValue([])
  vi.mocked(getQuickStats).mockResolvedValue({
    patientsThisWeek: 1,
    proceduresThisMonth: 2,
    revenueThisMonth: 300,
  })
  vi.mocked(getUpcomingFollowUps).mockResolvedValue([])
  vi.mocked(getRecentActivity).mockResolvedValue([])
  vi.mocked(countPendingReschedule).mockResolvedValue(0)
})

describe('GET /api/dashboard', () => {
  it('returns 200 with no month param and passes undefined through to getQuickStats', async () => {
    const res = await GET(makeRequest('http://localhost/api/dashboard'))
    expect(res.status).toBe(200)
    expect(getQuickStats).toHaveBeenCalledWith('tenant-1', undefined, undefined)
  })

  it('accepts a well-formed past month and passes it through', async () => {
    const res = await GET(makeRequest('http://localhost/api/dashboard?month=2026-02'))
    expect(res.status).toBe(200)
    expect(getQuickStats).toHaveBeenCalledWith('tenant-1', undefined, '2026-02')
  })

  it('rejects an out-of-range month number with 400', async () => {
    const res = await GET(makeRequest('http://localhost/api/dashboard?month=2026-13'))
    const json = await res.json()
    expect(res.status).toBe(400)
    expect(json.error).toBeTruthy()
    expect(getQuickStats).not.toHaveBeenCalled()
  })

  it('rejects the wrong separator with 400', async () => {
    const res = await GET(makeRequest('http://localhost/api/dashboard?month=2026/04'))
    expect(res.status).toBe(400)
    expect(getQuickStats).not.toHaveBeenCalled()
  })

  it('rejects a non-YYYY-MM string with 400', async () => {
    const res = await GET(makeRequest('http://localhost/api/dashboard?month=not-a-month'))
    expect(res.status).toBe(400)
  })

  it('rejects an empty month param with 400', async () => {
    const res = await GET(makeRequest('http://localhost/api/dashboard?month='))
    expect(res.status).toBe(400)
  })

  it('rejects a future month with 400', async () => {
    const res = await GET(makeRequest('http://localhost/api/dashboard?month=2099-01'))
    expect(res.status).toBe(400)
    expect(getQuickStats).not.toHaveBeenCalled()
  })
})
