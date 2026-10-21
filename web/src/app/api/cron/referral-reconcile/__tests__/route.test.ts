import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/referral/events', () => ({ reconcileReferrals: vi.fn() }))
vi.mock('@/lib/cron-monitor', () => ({
  withCronMonitor: vi.fn((_slug: string, _schedule: string, fn: () => Promise<unknown>) => fn()),
}))

import { GET } from '../route'
import { reconcileReferrals } from '@/lib/referral/events'
import { withCronMonitor } from '@/lib/cron-monitor'

const req = (auth?: string) =>
  new Request('http://x/api/cron/referral-reconcile', { headers: auth ? { authorization: auth } : {} })

beforeEach(() => {
  vi.mocked(reconcileReferrals).mockReset()
  vi.stubEnv('CRON_SECRET', 's3cret')
})
afterEach(() => {
  vi.unstubAllEnvs()
})

describe('GET /api/cron/referral-reconcile', () => {
  it('rejects a caller without the cron secret', async () => {
    expect((await GET(req())).status).toBe(401)
    expect((await GET(req('Bearer nope'))).status).toBe(401)
    expect(reconcileReferrals).not.toHaveBeenCalled()
  })

  it('runs the reconcile under the monitor with a deadline and returns the counts', async () => {
    vi.mocked(reconcileReferrals).mockResolvedValue({ refreshed: 3, synced: 2, failed: 1, skipped: 0 })
    const before = Date.now()

    const res = await GET(req('Bearer s3cret'))

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ ok: true, refreshed: 3, synced: 2, failed: 1, skipped: 0 })
    // The monitor schedule must be the one vercel.json declares, or Sentry reports every run as late.
    const vercelConfig = JSON.parse(
      fs.readFileSync(path.resolve(__dirname, '../../../../../../vercel.json'), 'utf8'),
    ) as { crons: Array<{ path: string; schedule: string }> }
    const cron = vercelConfig.crons.find((c) => c.path === '/api/cron/referral-reconcile')
    expect(cron).toBeDefined()
    expect(withCronMonitor).toHaveBeenCalledWith('referral-reconcile', cron?.schedule, expect.any(Function))
    const { deadlineAt } = vi.mocked(reconcileReferrals).mock.calls[0][0] as { deadlineAt: number }
    expect(deadlineAt).toBeGreaterThanOrEqual(before + 240_000)
    expect(deadlineAt).toBeLessThanOrEqual(Date.now() + 240_000)
  })
})
