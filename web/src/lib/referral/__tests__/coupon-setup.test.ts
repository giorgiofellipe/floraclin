import { describe, expect, it, vi } from 'vitest'
import type Stripe from 'stripe'
import {
  REFERRER_COUPON_IDS,
  WELCOME_COUPON_ID,
  WELCOME_PROMOTION_CODE,
  assertRunAllowed,
  couponSpecs,
  keyMode,
  setupReferralCoupons,
  type CouponSetupDeps,
  type CouponSpec,
} from '../coupon-setup'

function asCoupon(spec: Partial<CouponSpec> & { id: string }): Stripe.Coupon {
  return spec as unknown as Stripe.Coupon
}

function makeDeps(overrides: Partial<CouponSetupDeps> = {}) {
  const deps = {
    retrieveCoupon: vi.fn(async () => null),
    createCoupon: vi.fn(async (spec: CouponSpec) => asCoupon(spec)),
    findPromotionCode: vi.fn(async () => null),
    createPromotionCode: vi.fn(async () => ({ id: 'promo_new' }) as Stripe.PromotionCode),
    log: vi.fn(),
    ...overrides,
  } satisfies CouponSetupDeps
  return deps
}

describe('keyMode', () => {
  it('maps the four prefixes', () => {
    expect(keyMode('sk_live_x')).toBe('live')
    expect(keyMode('rk_live_x')).toBe('live')
    expect(keyMode('sk_test_x')).toBe('test')
    expect(keyMode('rk_test_x')).toBe('test')
  })

  it('throws on anything else', () => {
    expect(() => keyMode('pk_live_x')).toThrow()
    expect(() => keyMode('')).toThrow()
  })
})

describe('assertRunAllowed', () => {
  it('always allows test mode', () => {
    expect(() => assertRunAllowed('test', [], { CI: 'true' })).not.toThrow()
  })

  it('refuses live without --live', () => {
    expect(() => assertRunAllowed('live', [], {})).toThrow()
  })

  it('refuses live under CI, Vercel or GitHub Actions', () => {
    expect(() => assertRunAllowed('live', ['--live'], { CI: 'true' })).toThrow()
    expect(() => assertRunAllowed('live', ['--live'], { VERCEL: '1' })).toThrow()
    expect(() => assertRunAllowed('live', ['--live'], { GITHUB_ACTIONS: 'true' })).toThrow()
  })

  it('allows live with --live and a clean env', () => {
    expect(() => assertRunAllowed('live', ['--live'], {})).not.toThrow()
  })
})

describe('couponSpecs', () => {
  const specs = couponSpecs()

  it('has the welcome coupon: 20% for 2 months', () => {
    expect(specs[0]).toEqual({
      id: WELCOME_COUPON_ID,
      percent_off: 20,
      duration: 'repeating',
      duration_in_months: 2,
      name: 'Indicação: 20% nos 2 primeiros meses',
      metadata: { purpose: 'referral_welcome', app: 'floraclin' },
    })
  })

  it('has five forever referrer coupons in ascending order', () => {
    const referrers = specs.slice(1)
    expect(referrers.map((s) => s.id)).toEqual([...REFERRER_COUPON_IDS])
    expect(referrers.map((s) => s.percent_off)).toEqual([20, 40, 60, 80, 100])
    for (const s of referrers) {
      expect(s.duration).toBe('forever')
      expect(s).not.toHaveProperty('duration_in_months')
      expect(s.name).toBe(`Indique e Ganhe: ${s.percent_off}%`)
      expect(s.metadata).toEqual({
        purpose: 'referral_reward',
        app: 'floraclin',
        percent: String(s.percent_off),
      })
    }
  })

  it('never uses applies_to', () => {
    expect(JSON.stringify(specs)).not.toContain('applies_to')
  })
})

describe('setupReferralCoupons', () => {
  it('creates missing coupons and skips existing matching ones', async () => {
    const specs = couponSpecs()
    const deps = makeDeps({
      retrieveCoupon: vi.fn(async (id: string) =>
        id === WELCOME_COUPON_ID ? asCoupon(specs[0]) : null,
      ),
    })
    await setupReferralCoupons(deps)
    expect(deps.createCoupon).toHaveBeenCalledTimes(5)
    expect(vi.mocked(deps.createCoupon).mock.calls.map(([s]) => s.id)).toEqual([...REFERRER_COUPON_IDS])
  })

  it('throws on an existing coupon with different terms', async () => {
    const deps = makeDeps({
      retrieveCoupon: vi.fn(async (id: string) => {
        const spec = couponSpecs().find((s) => s.id === id)!
        return asCoupon({ ...spec, percent_off: spec.percent_off + 5 })
      }),
    })
    await expect(setupReferralCoupons(deps)).rejects.toThrow(/exists with different terms/)
    expect(deps.createCoupon).not.toHaveBeenCalled()
  })

  it('throws when an existing welcome coupon has different months', async () => {
    const deps = makeDeps({
      retrieveCoupon: vi.fn(async (id: string) => {
        const spec = couponSpecs().find((s) => s.id === id)!
        return asCoupon({ ...spec, duration_in_months: 3 })
      }),
    })
    await expect(setupReferralCoupons(deps)).rejects.toThrow(/different terms/)
  })

  it('reuses an existing promotion code', async () => {
    const deps = makeDeps({
      findPromotionCode: vi.fn(async () => ({ id: 'promo_existing' }) as Stripe.PromotionCode),
    })
    const out = await setupReferralCoupons(deps)
    expect(deps.createPromotionCode).not.toHaveBeenCalled()
    expect(out.promotionCodeId).toBe('promo_existing')
  })

  it('creates the promotion code for the welcome coupon when missing', async () => {
    const deps = makeDeps()
    await setupReferralCoupons(deps)
    expect(deps.findPromotionCode).toHaveBeenCalledWith(WELCOME_COUPON_ID, WELCOME_PROMOTION_CODE)
    expect(deps.createPromotionCode).toHaveBeenCalledWith({
      couponId: WELCOME_COUPON_ID,
      code: WELCOME_PROMOTION_CODE,
    })
  })

  it('returns the env lines in order', async () => {
    const out = await setupReferralCoupons(makeDeps())
    expect(out.envLines).toEqual([
      'STRIPE_REFERRAL_PROMOTION_CODE_ID=promo_new',
      'STRIPE_REFERRER_COUPON_IDS=floraclin_referrer_20,floraclin_referrer_40,floraclin_referrer_60,floraclin_referrer_80,floraclin_referrer_100',
    ])
  })
})
