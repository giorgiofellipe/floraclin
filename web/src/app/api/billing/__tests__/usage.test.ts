import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth', () => ({ getAuthContext: vi.fn() }))
const cookieJar = vi.hoisted(() => new Map<string, string>())
vi.mock('next/headers', () => ({ cookies: async () => ({ get: (n: string) => (cookieJar.has(n) ? { value: cookieJar.get(n) } : undefined) }) }))
vi.mock('@/db/client', () => ({
  db: {
    select: () => ({ from: () => ({ where: async () => [{ count: 1 }] }) }),
  },
}))
vi.mock('@/db/queries/subscriptions', () => ({ getSubscription: vi.fn(), listPlans: vi.fn(async () => [{ slug: 'pro' }]) }))
vi.mock('@/db/queries/whatsapp-credits', () => ({ getCreditUsage: vi.fn() }))
vi.mock('@/db/queries/referrals', () => ({
  getReferralAttribution: vi.fn(async () => null),
  loadCandidateTenants: vi.fn(),
  loadTenantSignals: vi.fn(),
  markReferralIneligible: vi.fn(),
}))
vi.mock('@/lib/stripe', () => ({
  getSubscriptionDiscount: vi.fn(async () => null),
  checkPromotionCode: vi.fn(),
  customerHasPriorPurchase: vi.fn(),
}))
vi.mock('@/lib/winback-offer', () => ({ getValidatedWinbackOffer: vi.fn(async () => null) }))
vi.mock('@/lib/referral/config', () => ({ isReferralEnrollmentEnabled: vi.fn(() => true) }))
vi.mock('@/lib/referral/offer', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/referral/offer')>()),
  getValidatedReferralOffer: vi.fn(async () => null),
}))

import { getAuthContext } from '@/lib/auth'
import { getSubscription } from '@/db/queries/subscriptions'
import { getCreditUsage } from '@/db/queries/whatsapp-credits'
import { getReferralAttribution } from '@/db/queries/referrals'
import { getValidatedWinbackOffer } from '@/lib/winback-offer'
import { isReferralEnrollmentEnabled } from '@/lib/referral/config'
import { getValidatedReferralOffer } from '@/lib/referral/offer'
import { GET } from '../usage/route'

const TRIAL = {
  tenantId: 't1',
  status: 'trialing',
  source: 'trial',
  firstPaidAt: null,
  stripeSubscriptionId: null,
  stripeCustomerId: null,
  currentPeriodEnd: new Date('2999-01-01T00:00:00.000Z'),
  planId: 'p1',
  plan: { name: 'Pro', slug: 'pro', priceCents: 9900, features: {}, limits: { users: 5, patients: 100 } },
}
const ATTRIBUTION = { id: 'r1', status: 'trial', stripeSubscriptionId: null, referrerTenantId: 'x', referrerName: 'Clínica Flor' }
const OFFER = {
  kind: 'referral',
  referrerName: 'Clínica Flor',
  label: '20% de desconto nos 2 primeiros meses',
  percentOff: 20,
  amountOffCents: null,
  duration: 'repeating',
  durationInMonths: 2,
  planSlugs: ['pro'],
  promotionCodeId: 'promo_secret',
  referralId: 'r1',
}

async function call() {
  const res = await GET(new Request('http://x/api/billing/usage'))
  return res.json()
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getAuthContext).mockResolvedValue({ tenantId: 't1', role: 'owner' } as never)
  vi.mocked(getSubscription).mockResolvedValue(TRIAL as never)
  vi.mocked(getCreditUsage).mockResolvedValue({ used: 3, total: 250, bonus: 50, periodEnd: new Date('2026-11-01T00:00:00Z') } as never)
  vi.mocked(isReferralEnrollmentEnabled).mockReturnValue(true)
  vi.mocked(getReferralAttribution).mockResolvedValue(null)
  vi.mocked(getValidatedWinbackOffer).mockResolvedValue(null)
  vi.mocked(getValidatedReferralOffer).mockResolvedValue(null)
})

describe('GET /api/billing/usage referral fields', () => {
  it('passes the WhatsApp bonus through', async () => {
    expect((await call()).usage.whatsapp).toMatchObject({ used: 3, limit: 250, bonus: 50 })
  })

  it('does no referral work with the switch off', async () => {
    vi.mocked(isReferralEnrollmentEnabled).mockReturnValue(false)
    const body = await call()
    expect(body.referral).toEqual({ offer: null, canEnterCode: false, linkCode: null })
    expect(getReferralAttribution).not.toHaveBeenCalled()
    expect(getValidatedReferralOffer).not.toHaveBeenCalled()
  })

  it('reads the attribution once and hands it to the offer', async () => {
    vi.mocked(getReferralAttribution).mockResolvedValue(ATTRIBUTION as never)
    await call()
    expect(getReferralAttribution).toHaveBeenCalledTimes(1)
    expect(vi.mocked(getValidatedReferralOffer).mock.calls[0][5]).toEqual({ attribution: ATTRIBUTION })
  })

  it('returns the public offer with a headline and no promotion code', async () => {
    vi.mocked(getReferralAttribution).mockResolvedValue(ATTRIBUTION as never)
    vi.mocked(getValidatedReferralOffer).mockResolvedValue(OFFER as never)
    const body = await call()
    expect(body.referral.offer.headline).toBe('Indicação de Clínica Flor: 20% de desconto nos 2 primeiros meses.')
    expect(JSON.stringify(body)).not.toContain('promo_secret')
    expect(body.referral.canEnterCode).toBe(false)
  })

  it('has no referral offer when a win-back offer exists', async () => {
    vi.mocked(getReferralAttribution).mockResolvedValue(ATTRIBUTION as never)
    vi.mocked(getValidatedWinbackOffer).mockResolvedValue({ promotionCodeId: 'w' } as never)
    vi.mocked(getValidatedReferralOffer).mockResolvedValue(OFFER as never)
    expect((await call()).referral.offer).toBeNull()
    expect(getValidatedReferralOffer).not.toHaveBeenCalled()
  })

  it('lets an owner without a payment or attribution enter a code', async () => {
    expect((await call()).referral.canEnterCode).toBe(true)
  })

  it.each([
    ['after the first payment', { firstPaidAt: new Date('2026-09-01T12:00:00-03:00') }, 'owner', null],
    ['with a Stripe subscription', { stripeSubscriptionId: 'sub_1' }, 'owner', null],
    ['with an existing attribution', {}, 'owner', ATTRIBUTION],
    ['for a non-owner', {}, 'admin', null],
  ])('cannot enter a code %s', async (_n, patch, role, attribution) => {
    vi.mocked(getSubscription).mockResolvedValue({ ...TRIAL, ...patch } as never)
    vi.mocked(getAuthContext).mockResolvedValue({ tenantId: 't1', role } as never)
    vi.mocked(getReferralAttribution).mockResolvedValue(attribution as never)
    expect((await call()).referral.canEnterCode).toBe(false)
  })

  it('pre-fills the code from a link cookie that signup did not attribute, only while a code can be entered', async () => {
    cookieJar.set('floraclin_ref', 'meca7k')
    expect((await call()).referral.linkCode).toBe('MECA7K')
    vi.mocked(getReferralAttribution).mockResolvedValue(ATTRIBUTION as never)
    expect((await call()).referral.linkCode).toBeNull()
    cookieJar.clear()
  })
})
