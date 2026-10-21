import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/db/queries/subscriptions', () => ({ expireLapsedSubscriptions: vi.fn() }))
vi.mock('@/lib/cron-monitor', () => ({
  withCronMonitor: vi.fn((_slug: string, _schedule: string, fn: () => Promise<unknown>) => fn()),
}))

import { GET } from '../route'
import { expireLapsedSubscriptions } from '@/db/queries/subscriptions'

const req = (auth?: string) =>
  new Request('http://x/api/cron/subscription-expiry', { headers: auth ? { authorization: auth } : {} })

beforeEach(() => {
  vi.mocked(expireLapsedSubscriptions).mockReset()
  vi.stubEnv('CRON_SECRET', 's3cret')
})
afterEach(() => {
  vi.unstubAllEnvs()
})

describe('GET /api/cron/subscription-expiry', () => {
  it('rejects a caller without the cron secret', async () => {
    expect((await GET(req())).status).toBe(401)
    expect(expireLapsedSubscriptions).not.toHaveBeenCalled()
  })

  it('expires lapsed trials, gifts and admin grants in one call and reports the count', async () => {
    vi.mocked(expireLapsedSubscriptions).mockResolvedValue([{ tenantId: 'a' }, { tenantId: 'b' }] as never)

    const res = await GET(req('Bearer s3cret'))

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ ok: true, expired: 2 })
    expect(expireLapsedSubscriptions).toHaveBeenCalledTimes(1)
  })
})
