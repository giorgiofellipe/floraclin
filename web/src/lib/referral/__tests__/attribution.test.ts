import { describe, expect, it, vi } from 'vitest'

vi.mock('@/db/client', () => ({ db: {} }))
vi.mock('@/db/queries/referrals', () => ({
  findReferrerByCode: vi.fn(),
  getReferralByReferredTenant: vi.fn(),
  insertReferral: vi.fn(),
  loadCandidateTenants: vi.fn(),
  loadTenantSignals: vi.fn(),
}))

import { attributeReferral, pickSignupCode, type AttributionDeps } from '../attribution'
import { runEligibilityChecks } from '../eligibility'
import type { CandidateTenant, TenantSignals } from '../types'

const ENABLED_ENV = {
  REFERRAL_ENROLLMENT_ENABLED: 'true',
  STRIPE_REFERRAL_PROMOTION_CODE_ID: 'promo_1',
  STRIPE_REFERRER_COUPON_IDS: 'c20,c40,c60,c80,c100',
}
const NOW = new Date('2026-10-21T15:00:00.000Z')
const SIGNUP_AT = new Date('2026-10-21T14:59:00.000Z')

const signals = (tenantId: string, over: Partial<TenantSignals> = {}): TenantSignals => ({
  tenantId, ownerEmails: [], phones: [], registries: [], userIds: [], cardFingerprints: [], ...over,
})

function makeDeps(over: Partial<AttributionDeps> = {}) {
  const deps = {
    now: () => NOW,
    env: ENABLED_ENV,
    findReferrer: vi.fn(async () => ({ tenantId: 'referrer', name: 'Ref', canRefer: true })),
    existing: vi.fn(async () => null),
    signupAt: vi.fn(async () => SIGNUP_AT),
    loadSignals: vi.fn(async (id: string) => signals(id)),
    loadCandidates: vi.fn(async () => [] as CandidateTenant[]),
    runChecks: runEligibilityChecks,
    insert: vi.fn(async (input: { status: string }) => ({ id: 'ref-1', status: input.status })),
    ...over,
  }
  return deps as typeof deps & AttributionDeps
}
const input = (rawCode: unknown) => ({ referredTenantId: 'referred', rawCode, capturedVia: 'signup_field' as const })
const attribute = (rawCode: unknown, deps: AttributionDeps) => attributeReferral(input(rawCode), deps)

describe('attributeReferral skips', () => {
  it('disabled when the switch is off, before any lookup', async () => {
    const deps = makeDeps({ env: {} })
    expect(await attribute('MECA7K', deps)).toEqual({ outcome: 'skipped', reason: 'disabled' })
    expect(deps.findReferrer).not.toHaveBeenCalled()
  })

  it.each([null, undefined, ''])('no_code for %j', async (raw) => {
    expect(await attribute(raw, makeDeps())).toEqual({ outcome: 'skipped', reason: 'no_code' })
  })

  it('invalid_code for a malformed code, without a lookup', async () => {
    const deps = makeDeps()
    expect(await attribute('ME0A7K', deps)).toEqual({ outcome: 'skipped', reason: 'invalid_code' })
    expect(deps.findReferrer).not.toHaveBeenCalled()
  })

  it('unknown_or_inactive when no tenant has the code, or it cannot refer', async () => {
    expect(await attribute('MECA7K', makeDeps({ findReferrer: vi.fn(async () => null) }))).toEqual({ outcome: 'skipped', reason: 'unknown_or_inactive' })
    const inactive = makeDeps({ findReferrer: vi.fn(async () => ({ tenantId: 'referrer', name: 'R', canRefer: false })) })
    expect(await attribute('MECA7K', inactive)).toEqual({ outcome: 'skipped', reason: 'unknown_or_inactive' })
  })

  it('same_tenant', async () => {
    const deps = makeDeps({ findReferrer: vi.fn(async () => ({ tenantId: 'referred', name: 'R', canRefer: true })) })
    expect(await attribute('MECA7K', deps)).toEqual({ outcome: 'skipped', reason: 'same_tenant' })
    expect(deps.insert).not.toHaveBeenCalled()
  })

  it('already_attributed when a referral exists, before the checks run', async () => {
    const deps = makeDeps({ existing: vi.fn(async () => ({ id: 'old' }) as never), runChecks: vi.fn() })
    expect(await attribute('MECA7K', deps)).toEqual({ outcome: 'skipped', reason: 'already_attributed' })
    expect(deps.runChecks).not.toHaveBeenCalled()
  })

  it('already_attributed when the insert loses a race', async () => {
    const deps = makeDeps({ insert: vi.fn(async () => null) })
    expect(await attribute('MECA7K', deps)).toEqual({ outcome: 'skipped', reason: 'already_attributed' })
  })
})

describe('attributeReferral outcomes', () => {
  it('runs the checks at stage attribution with the referred tenant signup time', async () => {
    const runChecks = vi.fn(async () => ({ selfReferral: [], notNew: [], verdict: null }))
    const deps = makeDeps({ runChecks })
    await attribute('MECA7K', deps)
    expect(deps.signupAt).toHaveBeenCalledWith('referred')
    expect(runChecks).toHaveBeenCalledWith(
      { referredTenantId: 'referred', referrerTenantId: 'referrer', referredSignupAt: SIGNUP_AT, stage: 'attribution' },
      { loadSignals: deps.loadSignals, loadCandidates: deps.loadCandidates },
    )
  })

  it('creates a trial referral with the atSignup snapshot for a clean case', async () => {
    const deps = makeDeps()
    expect(await attribute(' meca7k ', deps)).toEqual({ outcome: 'created', referralId: 'ref-1', status: 'trial' })
    expect(deps.insert).toHaveBeenCalledWith({
      referrerTenantId: 'referrer',
      referredTenantId: 'referred',
      code: 'MECA7K',
      capturedVia: 'signup_field',
      capturedAt: NOW,
      status: 'trial',
      ineligibleReason: null,
      checks: { atSignup: { selfReferral: [], notNew: [] } },
    })
  })

  it('creates ineligible/self_referral when the clinics share a user', async () => {
    const deps = makeDeps({
      loadSignals: vi.fn(async (id: string) => signals(id, { userIds: ['user-1'] })),
    })
    expect(await attribute('MECA7K', deps)).toEqual({ outcome: 'created', referralId: 'ref-1', status: 'ineligible' })
    expect(deps.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'ineligible',
        ineligibleReason: 'self_referral',
        checks: { atSignup: { selfReferral: ['shared_user'], notNew: [] } },
      }),
    )
  })

  it('creates ineligible/not_new when another recent tenant shares the owner email', async () => {
    const candidate: CandidateTenant = {
      ...signals('old-tenant', { ownerEmails: ['dra@clinica.com'] }),
      subscriptionCreatedAt: new Date('2026-08-01T12:00:00.000Z'),
      subscriptionEndsAt: new Date('2026-12-01T12:00:00.000Z'),
      cards: [],
    }
    const deps = makeDeps({
      loadSignals: vi.fn(async (id: string) => signals(id, id === 'referred' ? { ownerEmails: ['dra@clinica.com'] } : {})),
      loadCandidates: vi.fn(async () => [candidate]),
    })
    expect(await attribute('MECA7K', deps)).toEqual({ outcome: 'created', referralId: 'ref-1', status: 'ineligible' })
    expect(deps.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'ineligible',
        ineligibleReason: 'not_new',
        checks: { atSignup: { selfReferral: [], notNew: [{ tenantId: 'old-tenant', signals: ['owner_email'] }] } },
      }),
    )
  })
})

describe('pickSignupCode', () => {
  it('uses the cookie as a link when the field is empty', () => {
    expect(pickSignupCode({ field: '', cookie: 'meca7k' })).toEqual({ code: 'MECA7K', via: 'link' })
    expect(pickSignupCode({ field: null, cookie: 'MECA7K' })).toEqual({ code: 'MECA7K', via: 'link' })
  })

  it('lets the typed field win over the cookie, normalised', () => {
    expect(pickSignupCode({ field: ' abc234 ', cookie: 'MECA7K' })).toEqual({ code: 'ABC234', via: 'signup_field' })
  })

  it('a malformed typed field does not silently fall back to the cookie', () => {
    expect(pickSignupCode({ field: 'ME0A7K', cookie: 'MECA7K' })).toBeNull()
  })

  it('null when neither is usable', () => {
    expect(pickSignupCode({ field: undefined, cookie: undefined })).toBeNull()
    expect(pickSignupCode({ field: '', cookie: 'bad!' })).toBeNull()
  })
})
