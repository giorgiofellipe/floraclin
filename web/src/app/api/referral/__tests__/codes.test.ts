import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/db/queries/referrals', () => ({ findReferrerByCode: vi.fn() }))
vi.mock('@/lib/observability', () => ({ reportSideEffectFailure: vi.fn() }))
vi.mock('@/lib/referral/config', () => ({ isReferralEnrollmentEnabled: vi.fn() }))

import { findReferrerByCode } from '@/db/queries/referrals'
import { reportSideEffectFailure } from '@/lib/observability'
import { isReferralEnrollmentEnabled } from '@/lib/referral/config'
import { GET } from '../codes/[code]/route'

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
