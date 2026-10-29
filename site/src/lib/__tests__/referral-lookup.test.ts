import { describe, it, expect, vi, afterEach } from 'vitest'
import { lookupReferralCode, referralRewardsEndAt, APP_ORIGIN_DEFAULT } from '../referral-lookup'

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })

afterEach(() => vi.unstubAllEnvs())

describe('lookupReferralCode', () => {
  it('never fetches a malformed code', async () => {
    const fetchImpl = vi.fn()
    expect(await lookupReferralCode('MEC-7K', { fetchImpl })).toEqual({ active: false })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('maps active and inactive responses', async () => {
    const active = vi.fn().mockResolvedValue(json({ active: true, clinicName: 'Clínica Flor' }))
    expect(await lookupReferralCode('meca7k', { fetchImpl: active })).toEqual({ active: true, clinicName: 'Clínica Flor' })
    expect(active).toHaveBeenCalledWith(`${APP_ORIGIN_DEFAULT}/api/referral/codes/MECA7K`, { next: { revalidate: 60 } })
    const inactive = vi.fn().mockResolvedValue(json({ active: false }))
    expect(await lookupReferralCode('MECA7K', { fetchImpl: inactive })).toEqual({ active: false })
  })

  it('returns inactive on non-200, thrown fetch and bad JSON shape', async () => {
    expect(await lookupReferralCode('MECA7K', { fetchImpl: vi.fn().mockResolvedValue(json({}, 500)) })).toEqual({ active: false })
    expect(await lookupReferralCode('MECA7K', { fetchImpl: vi.fn().mockRejectedValue(new Error('x')) })).toEqual({ active: false })
    expect(await lookupReferralCode('MECA7K', { fetchImpl: vi.fn().mockResolvedValue(json({ active: true })) })).toEqual({ active: false })
    expect(await lookupReferralCode('MECA7K', { fetchImpl: vi.fn().mockResolvedValue(new Response('nope')) })).toEqual({ active: false })
  })

  it('uses FLORACLIN_APP_ORIGIN', async () => {
    vi.stubEnv('FLORACLIN_APP_ORIGIN', 'https://staging.example.com')
    const fetchImpl = vi.fn().mockResolvedValue(json({ active: false }))
    await lookupReferralCode('MECA7K', { fetchImpl })
    expect(fetchImpl.mock.calls[0][0]).toBe('https://staging.example.com/api/referral/codes/MECA7K')
  })
})

describe('referralRewardsEndAt', () => {
  const at = (raw: string) => referralRewardsEndAt({ REFERRAL_REWARDS_END_AT: raw })

  it('accepts a full ISO timestamp with offset, like web', () => {
    expect(at('2027-01-15T02:00:00-03:00')?.toISOString()).toBe('2027-01-15T05:00:00.000Z')
    expect(at('2027-01-15T05:00Z')?.toISOString()).toBe('2027-01-15T05:00:00.000Z')
  })

  it.each(['2027-01-01', '2027-01-15T02:00:00', 'not-a-date', ''])('rejects %j (a bare date would be read as UTC)', (raw) => {
    expect(at(raw)).toBeNull()
  })
})
