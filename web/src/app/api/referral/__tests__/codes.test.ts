import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/db/queries/referrals', () => ({ findReferrerByCode: vi.fn() }))
vi.mock('@/lib/observability', () => ({ reportSideEffectFailure: vi.fn() }))
vi.mock('@/lib/referral/config', () => ({ isReferralEnrollmentEnabled: vi.fn() }))

import { findReferrerByCode } from '@/db/queries/referrals'
import { reportSideEffectFailure } from '@/lib/observability'
import { isReferralEnrollmentEnabled } from '@/lib/referral/config'
import { GET } from '../codes/[code]/route'
import { CODE_LOOKUPS_PER_MINUTE } from '@/lib/referral/custom-code'

const call = (code: string) => GET(new Request(`http://localhost/api/referral/codes/${code}`), { params: Promise.resolve({ code }) })

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(isReferralEnrollmentEnabled).mockReturnValue(true)
})

describe('GET /api/referral/codes/[code]', () => {
  it('returns the clinic name for an active code, with the cache header', async () => {
    vi.mocked(findReferrerByCode).mockResolvedValue({ tenantId: 't1', name: '  Clínica   Flora ', canRefer: true })
    const res = await call('meca7k')
    expect(await res.json()).toEqual({ active: true, clinicName: 'Clínica Flora' })
    expect(findReferrerByCode).toHaveBeenCalledWith('MECA7K')
    expect(res.headers.get('Cache-Control')).toBe('public, s-maxage=300, stale-while-revalidate=600')
  })

  it('leaves the clinic name out for ?fields=active (the signup field), still cacheable', async () => {
    vi.mocked(findReferrerByCode).mockResolvedValue({ tenantId: 't1', name: 'Clínica Flora', canRefer: true })
    const get = (query: string) =>
      GET(new Request(`http://localhost/api/referral/codes/meca7k${query}`), { params: Promise.resolve({ code: 'meca7k' }) })
    const res = await get('?fields=active')
    expect(await res.json()).toEqual({ active: true })
    expect(res.headers.get('Cache-Control')).toBe('public, s-maxage=300, stale-while-revalidate=600')
    expect(await (await get('?fields=other')).json()).toEqual({ active: true, clinicName: 'Clínica Flora' })
  })

  it.each([
    ['unknown', null],
    ['inactive', { tenantId: 't1', name: 'X', canRefer: false }],
  ])('reports %s codes as inactive', async (_label, row) => {
    vi.mocked(findReferrerByCode).mockResolvedValue(row)
    const res = await call('MECA7K')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ active: false })
    expect(res.headers.get('Cache-Control')).toContain('s-maxage=300')
  })

  it('does not touch the DB for a malformed code', async () => {
    const res = await call('MEC-7K')
    expect(await res.json()).toEqual({ active: false })
    expect(findReferrerByCode).not.toHaveBeenCalled()
  })

  it('does not touch the DB when the switch is off', async () => {
    vi.mocked(isReferralEnrollmentEnabled).mockReturnValue(false)
    const res = await call('MECA7K')
    expect(await res.json()).toEqual({ active: false })
    expect(findReferrerByCode).not.toHaveBeenCalled()
  })

  it('answers inactive and reports when the lookup throws', async () => {
    vi.mocked(findReferrerByCode).mockRejectedValue(new Error('db down'))
    const res = await call('MECA7K')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ active: false })
    expect(reportSideEffectFailure).toHaveBeenCalledWith(expect.any(Error), { area: 'referral', step: 'code_lookup' })
  })
})

describe('GET /api/referral/codes/[code] rate limit', () => {
  it(`answers 429 { active: false } past the per-minute limit for one client, without a DB lookup`, async () => {
    vi.mocked(findReferrerByCode).mockResolvedValue(null)
    const fromIp = (ip: string) =>
      GET(new Request('http://localhost/api/referral/codes/MECA7K', { headers: { 'x-forwarded-for': ip } }), {
        params: Promise.resolve({ code: 'MECA7K' }),
      })
    for (let i = 0; i < CODE_LOOKUPS_PER_MINUTE; i++) expect((await fromIp('9.9.9.9')).status).toBe(200)
    vi.mocked(findReferrerByCode).mockClear()
    const blocked = await fromIp('9.9.9.9')
    expect(blocked.status).toBe(429)
    expect(await blocked.json()).toEqual({ active: false })
    expect(blocked.headers.get('Cache-Control')).toBe('no-store')
    expect(findReferrerByCode).not.toHaveBeenCalled()
    expect((await fromIp('8.8.8.8')).status).toBe(200)
  })
})
