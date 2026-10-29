import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth', () => ({ getAuthContext: vi.fn() }))
vi.mock('@/db/queries/subscriptions', () => ({ getSubscription: vi.fn() }))
vi.mock('@/db/queries/referrals', () => ({
  getOrCreateReferralCode: vi.fn(),
  countCountingReferrals: vi.fn(),
  listReferralsForReferrer: vi.fn(),
  listRewardEvents: vi.fn(),
  listPreviousReferralCodes: vi.fn(async () => []),
  isReferrer: vi.fn(async () => false),
}))
vi.mock('@/lib/referral/config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/referral/config')>()),
  isReferralEnrollmentEnabled: vi.fn(),
  areReferralRewardsActive: vi.fn(),
}))

import { getAuthContext } from '@/lib/auth'
import { getSubscription } from '@/db/queries/subscriptions'
import {
  countCountingReferrals,
  getOrCreateReferralCode,
  isReferrer,
  listReferralsForReferrer,
  listRewardEvents,
} from '@/db/queries/referrals'
import { areReferralRewardsActive, isReferralEnrollmentEnabled } from '@/lib/referral/config'
import { GET } from '../route'

const request = () => new Request('http://localhost/api/referral')
const plan = { priceCents: 9900, billingInterval: 'month' }

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getAuthContext).mockResolvedValue({ tenantId: 'tenant-1', userId: 'u1', role: 'owner' } as never)
  vi.mocked(isReferralEnrollmentEnabled).mockReturnValue(true)
  vi.mocked(areReferralRewardsActive).mockReturnValue(true)
  vi.mocked(getOrCreateReferralCode).mockResolvedValue('MECA7K')
  vi.mocked(countCountingReferrals).mockResolvedValue(3)
  vi.mocked(listReferralsForReferrer).mockResolvedValue([])
  vi.mocked(listRewardEvents).mockResolvedValue([])
})

describe('GET /api/referral', () => {
  it('403 for a non-owner', async () => {
    vi.mocked(getAuthContext).mockResolvedValue({ tenantId: 'tenant-1', role: 'secretary' } as never)
    expect((await GET(request())).status).toBe(403)
    expect(getSubscription).not.toHaveBeenCalled()
  })

  it.each([
    ['rewards are off too', false, true],
    ['the clinic never referred anyone', true, false],
  ])('404 with the switch off when %s', async (_n, rewardsActive, referrer) => {
    vi.mocked(isReferralEnrollmentEnabled).mockReturnValue(false)
    vi.mocked(areReferralRewardsActive).mockReturnValue(rewardsActive)
    vi.mocked(isReferrer).mockResolvedValue(referrer)
    expect((await GET(request())).status).toBe(404)
    expect(getSubscription).not.toHaveBeenCalled()
  })

  it('after enrollment closes, still shows a referrer the dashboard, without creating or showing a code', async () => {
    vi.mocked(isReferralEnrollmentEnabled).mockReturnValue(false)
    vi.mocked(isReferrer).mockResolvedValue(true)
    vi.mocked(getSubscription).mockResolvedValue({ source: 'stripe', status: 'active', plan } as never)
    const res = await GET(request())
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ code: null, link: null })
    expect(getOrCreateReferralCode).not.toHaveBeenCalled()
  })

  it('does not create a code for a clinic that is not paying through Stripe', async () => {
    vi.mocked(getSubscription).mockResolvedValue({ source: 'admin', status: 'active', plan } as never)
    const res = await GET(request())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(getOrCreateReferralCode).not.toHaveBeenCalled()
    expect(body.canRefer).toBe(false)
    expect(body.link).toBeNull()
  })

  it('creates the code for a paying clinic and returns the dashboard', async () => {
    vi.mocked(getSubscription).mockResolvedValue({
      source: 'stripe',
      status: 'active',
      plan,
      currentPeriodEnd: new Date('2026-11-10T15:00:00Z'),
    } as never)
    const res = await GET(request())
    const body = await res.json()
    expect(getOrCreateReferralCode).toHaveBeenCalledWith('tenant-1')
    expect(listRewardEvents).toHaveBeenCalledWith('tenant-1', 10)
    expect(body.link).toBe('https://floraclin.com.br/indicacao/MECA7K')
    expect(body.discountLine).toBe(
      'Seu desconto atual: 60% (R$ 59,40 de R$ 99,00) a partir da próxima fatura, em 10/11.',
    )
  })
})
