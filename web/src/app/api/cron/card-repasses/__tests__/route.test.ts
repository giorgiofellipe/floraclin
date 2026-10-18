import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@sentry/nextjs', () => ({
  captureException: vi.fn(),
  withMonitor: (_slug: string, body: () => Promise<unknown>) => body(),
  flush: vi.fn().mockResolvedValue(true),
}))
vi.mock('@/db/queries/card-payments', () => ({
  listTenantsWithDueRepasses: vi.fn(),
  postDueRepassesTx: vi.fn(),
}))
vi.mock('@/lib/tenant', () => ({
  withTransaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn({ tx: true })),
}))
vi.mock('@/lib/dates', () => ({ brToday: () => '2026-10-18' }))
vi.mock('@/lib/observability', () => ({ reportSideEffectFailure: vi.fn() }))

import { listTenantsWithDueRepasses, postDueRepassesTx } from '@/db/queries/card-payments'
import { withTransaction } from '@/lib/tenant'
import { reportSideEffectFailure } from '@/lib/observability'
import { GET } from '../route'

function request(auth?: string) {
  return new Request('http://localhost/api/cron/card-repasses', {
    headers: auth ? { authorization: auth } : {},
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('CRON_SECRET', 'secret')
})

describe('GET /api/cron/card-repasses', () => {
  it('returns 401 without the bearer secret and posts nothing', async () => {
    const res = await GET(request())

    expect(res.status).toBe(401)
    expect(listTenantsWithDueRepasses).not.toHaveBeenCalled()
  })

  it('posts each tenant in its own transaction using the BR day', async () => {
    vi.mocked(listTenantsWithDueRepasses).mockResolvedValue(['t1', 't2'])
    vi.mocked(postDueRepassesTx).mockResolvedValueOnce(2).mockResolvedValueOnce(3)

    const res = await GET(request('Bearer secret'))

    expect(listTenantsWithDueRepasses).toHaveBeenCalledWith('2026-10-18')
    expect(withTransaction).toHaveBeenCalledTimes(2)
    expect(postDueRepassesTx).toHaveBeenCalledWith({ tx: true }, 't1', { todayYmd: '2026-10-18' })
    expect(postDueRepassesTx).toHaveBeenCalledWith({ tx: true }, 't2', { todayYmd: '2026-10-18' })
    expect(await res.json()).toEqual({ ok: true, posted: 5, failedTenants: 0 })
  })

  it('keeps going when one tenant throws and reports it', async () => {
    vi.mocked(listTenantsWithDueRepasses).mockResolvedValue(['t1', 't2'])
    vi.mocked(postDueRepassesTx).mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(4)

    const res = await GET(request('Bearer secret'))

    expect(postDueRepassesTx).toHaveBeenCalledTimes(2)
    expect(reportSideEffectFailure).toHaveBeenCalledTimes(1)
    expect(await res.json()).toEqual({ ok: true, posted: 4, failedTenants: 1 })
  })
})
