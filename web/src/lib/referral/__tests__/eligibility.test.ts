import { describe, expect, it, vi } from 'vitest'
import {
  PUBLIC_EMAIL_DOMAINS, eligibilityVerdict, emailDomain, notNewMatches, runEligibilityChecks, selfReferralMatches,
} from '../eligibility'
import type { CandidateTenant, TenantSignals } from '../types'

const empty = (tenantId: string): TenantSignals => ({
  tenantId, ownerEmails: [], phones: [], registries: [], userIds: [], cardFingerprints: [],
})
const sig = (tenantId: string, p: Partial<TenantSignals> = {}): TenantSignals => ({ ...empty(tenantId), ...p })

const SIGNUP = new Date('2026-06-15T15:00:00Z')
const monthsBefore = (n: number) => { const d = new Date(SIGNUP); d.setUTCMonth(d.getUTCMonth() - n); return d }
const cand = (tenantId: string, p: Partial<CandidateTenant> = {}): CandidateTenant => ({
  ...empty(tenantId), subscriptionCreatedAt: monthsBefore(12), subscriptionEndsAt: monthsBefore(1), cards: [], ...p,
})

describe('selfReferralMatches', () => {
  it.each([
    ['owner_email', { ownerEmails: ['a@clinicabela.com.br'] }],
    ['phone', { phones: ['11999990000'] }],
    ['registry', { registries: ['CRM:123:SP'] }],
    ['shared_user', { userIds: ['u1'] }],
    ['card', { cardFingerprints: ['fp1'] }],
  ] as Array<[string, Partial<TenantSignals>]>)('matches %s', (kind, p) => {
    expect(selfReferralMatches(sig('a', p), sig('b', p))).toContain(kind)
  })

  it('matches a custom email domain but not webmail', () => {
    expect(selfReferralMatches(sig('a', { ownerEmails: ['x@clinicabela.com.br'] }), sig('b', { ownerEmails: ['y@clinicabela.com.br'] })))
      .toEqual(['email_domain'])
    expect(selfReferralMatches(sig('a', { ownerEmails: ['x@gmail.com'] }), sig('b', { ownerEmails: ['y@gmail.com'] }))).toEqual([])
    expect(PUBLIC_EMAIL_DOMAINS.has('gmail.com')).toBe(true)
  })

  it('never matches empty values and returns sorted unique kinds', () => {
    expect(selfReferralMatches(sig('a', { phones: [''] }), sig('b', { phones: [''] }))).toEqual([])
    const p = { ownerEmails: ['x@clinicabela.com.br'], phones: ['1'], userIds: ['u'] }
    expect(selfReferralMatches(sig('a', p), sig('b', p))).toEqual(['email_domain', 'owner_email', 'phone', 'shared_user'])
  })
})

describe('emailDomain', () => {
  it('extracts a lower-cased domain', () => {
    expect(emailDomain(' A@Clinica.COM ')).toBe('clinica.com')
    expect(emailDomain('nope')).toBeNull()
  })
})

describe('notNewMatches', () => {
  const referred = sig('ref', { ownerEmails: ['a@gmail.com'], phones: ['11'], registries: ['CRM:1:SP'], cardFingerprints: ['fp'] })
  const withEmail = { ownerEmails: ['a@gmail.com'] }

  it('applies the 6-month window to the subscription row for identity signals', () => {
    expect(notNewMatches(referred, [cand('c', { ...withEmail, subscriptionEndsAt: monthsBefore(7) })], SIGNUP, [])).toEqual([])
    expect(notNewMatches(referred, [cand('c', { ...withEmail, subscriptionEndsAt: monthsBefore(5) })], SIGNUP, []))
      .toEqual([{ tenantId: 'c', signals: ['owner_email'] }])
  })

  it('ignores a candidate subscription created after the signup', () => {
    const c = cand('c', { ...withEmail, subscriptionCreatedAt: new Date(SIGNUP.getTime() + 1000) })
    expect(notNewMatches(referred, [c], SIGNUP, [])).toEqual([])
  })

  it('card window uses sightings, not the subscription row', () => {
    const card = (first: Date, last: Date) => [{ fingerprint: 'fp', firstSeenAt: first, lastSeenAt: last }]
    const old = { subscriptionEndsAt: monthsBefore(24), subscriptionCreatedAt: monthsBefore(30) }
    expect(notNewMatches(referred, [cand('c', { cards: card(monthsBefore(12), monthsBefore(7)) })], SIGNUP, [], ['card'])).toEqual([])
    expect(notNewMatches(referred, [cand('c', { ...old, cards: card(monthsBefore(12), monthsBefore(5)) })], SIGNUP, [], ['card']))
      .toEqual([{ tenantId: 'c', signals: ['card'] }])
    expect(notNewMatches(referred, [cand('c', { cards: card(new Date(SIGNUP.getTime() + 1000), SIGNUP) })], SIGNUP, [], ['card'])).toEqual([])
    // a later gift extending the row does not rescue a stale card
    expect(notNewMatches(referred, [cand('c', { subscriptionEndsAt: monthsBefore(-12), cards: card(monthsBefore(12), monthsBefore(7)) })], SIGNUP, [], ['card'])).toEqual([])
  })

  it('kinds restricts the checked signals', () => {
    expect(notNewMatches(referred, [cand('c', withEmail)], SIGNUP, [], ['card'])).toEqual([])
  })

  it('skips excluded ids and the referred tenant, and sorts by tenant id', () => {
    const out = notNewMatches(referred, [cand('z', withEmail), cand('x', withEmail), cand('ref', withEmail), cand('b', withEmail)], SIGNUP, ['x'])
    expect(out.map((m) => m.tenantId)).toEqual(['b', 'z'])
  })
})

describe('eligibilityVerdict', () => {
  it('prefers self_referral', () => {
    expect(eligibilityVerdict(['phone'], [{ tenantId: 'c', signals: ['phone'] }])).toBe('self_referral')
    expect(eligibilityVerdict([], [{ tenantId: 'c', signals: ['phone'] }])).toBe('not_new')
    expect(eligibilityVerdict([], [])).toBeNull()
  })
})

describe('runEligibilityChecks', () => {
  const mk = (referredSignals: TenantSignals, referrerSignals: TenantSignals, candidates: CandidateTenant[]) => {
    const loadSignals = vi.fn(async (id: string) => (id === 'referred' ? referredSignals : referrerSignals))
    const loadCandidates = vi.fn(async () => candidates)
    return { loadSignals, loadCandidates }
  }
  const input = (stage: 'attribution' | 'checkout' | 'qualification') =>
    ({ referredTenantId: 'referred', referrerTenantId: 'referrer', referredSignupAt: SIGNUP, stage })

  it('qualification: shared phone is self-referral, never not-new', async () => {
    const l = mk(sig('referred', { phones: ['11'] }), sig('referrer', { phones: ['11'] }), [cand('c', { phones: ['11'] })])
    const r = await runEligibilityChecks(input('qualification'), l)
    expect(r.selfReferral).toEqual(['phone'])
    expect(r.notNew).toEqual([])
    expect(r.verdict).toBe('self_referral')
  })

  it('attribution: phone match with an in-window candidate is not-new', async () => {
    const l = mk(sig('referred', { phones: ['11'] }), sig('referrer'), [cand('c', { phones: ['11'] })])
    const r = await runEligibilityChecks(input('attribution'), l)
    expect(r.notNew).toEqual([{ tenantId: 'c', signals: ['phone'] }])
    expect(r.verdict).toBe('not_new')
    expect(l.loadCandidates).toHaveBeenCalledWith(expect.anything(), ['referrer', 'referred'])
  })

  it('attribution ignores a shared card for self-referral; qualification flags it', async () => {
    const a = sig('referred', { cardFingerprints: ['fp'] })
    const b = sig('referrer', { cardFingerprints: ['fp'] })
    expect((await runEligibilityChecks(input('checkout'), mk(a, b, []))).selfReferral).toEqual([])
    expect((await runEligibilityChecks(input('qualification'), mk(a, b, []))).selfReferral).toEqual(['card'])
  })

  it('qualification not-new checks the card only', async () => {
    const card = { fingerprint: 'fp', firstSeenAt: monthsBefore(10), lastSeenAt: monthsBefore(2) }
    const c = cand('c', { phones: ['11'], cards: [card] })
    const r = await runEligibilityChecks(input('qualification'), mk(sig('referred', { phones: ['11'], cardFingerprints: ['fp'] }), sig('referrer'), [c]))
    expect(r.notNew).toEqual([{ tenantId: 'c', signals: ['card'] }])
  })
})
