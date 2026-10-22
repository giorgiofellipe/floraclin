import { describe, expect, it } from 'vitest'
import {
  computeReferralStatus,
  isCountingStatus,
  isTerminalStatus,
  referralStatusLabel,
  type ReferredSnapshot,
} from '../status'
import type { ReferralState, ReferralStatus } from '../types'

const NOW = new Date('2026-11-01T15:00:00.000Z')
const T1 = new Date('2026-09-01T15:00:00.000Z')
const T2 = new Date('2026-10-01T15:00:00.000Z')

const state = (o: Partial<ReferralState> = {}): ReferralState => ({
  status: 'trial',
  pausedReason: null,
  ineligibleReason: null,
  stripeSubscriptionId: null,
  firstPaidAt: null,
  qualifiedAt: null,
  qualifyingInvoiceId: null,
  endedAt: null,
  ...o,
})

type StripeSnap = NonNullable<ReferredSnapshot['stripe']>
const stripe = (o: Partial<StripeSnap> = {}): StripeSnap => ({
  subscriptionId: 'sub_1',
  status: 'active',
  cancelAtPeriodEnd: false,
  monthly: true,
  firstPaidAt: T1,
  qualifyingInvoice: null,
  ...o,
})

const snap = (o: Partial<ReferredSnapshot> = {}): ReferredSnapshot => ({
  now: NOW,
  tenantDeleted: false,
  localTrialEnded: false,
  stripe: null,
  ineligible: null,
  ...o,
})

const counting = (o: Partial<ReferralState> = {}) =>
  state({
    status: 'counting',
    stripeSubscriptionId: 'sub_1',
    firstPaidAt: T1,
    qualifiedAt: T2,
    qualifyingInvoiceId: 'in_2',
    ...o,
  })

describe('computeReferralStatus rules', () => {
  it('R0: ineligible is terminal', () => {
    const prev = state({ status: 'ineligible', ineligibleReason: 'not_new', endedAt: T1 })
    const next = computeReferralStatus(prev, snap({ ineligible: 'admin', stripe: stripe() }))
    expect(next).toEqual(prev)
  })

  it('R1: snapshot verdict makes it ineligible and keeps an earlier endedAt', () => {
    const next = computeReferralStatus(
      counting({ endedAt: T1, pausedReason: 'past_due' }),
      snap({ ineligible: 'chargeback', stripe: stripe() }),
    )
    expect(next).toMatchObject({
      status: 'ineligible',
      ineligibleReason: 'chargeback',
      pausedReason: null,
      endedAt: T1,
    })
  })

  it('R1: sets endedAt to now when there was none', () => {
    const next = computeReferralStatus(state(), snap({ ineligible: 'self_referral' }))
    expect(next.endedAt).toEqual(NOW)
  })

  it('R2: canceled stays canceled when the clinic comes back', () => {
    const prev = state({ status: 'canceled', endedAt: T1, stripeSubscriptionId: 'sub_1' })
    expect(computeReferralStatus(prev, snap({ stripe: stripe() }))).toEqual(prev)
  })

  it('R2: canceled plus a chargeback becomes ineligible', () => {
    const prev = state({ status: 'canceled', endedAt: T1 })
    const next = computeReferralStatus(prev, snap({ ineligible: 'chargeback' }))
    expect(next).toMatchObject({ status: 'ineligible', ineligibleReason: 'chargeback', endedAt: T1 })
  })

  it('R3: deleted tenant becomes canceled', () => {
    const next = computeReferralStatus(counting(), snap({ tenantDeleted: true, stripe: stripe() }))
    expect(next).toMatchObject({ status: 'canceled', endedAt: NOW })
  })

  describe('R4: no Stripe subscription', () => {
    it('trial stays trial', () => {
      expect(computeReferralStatus(state(), snap()).status).toBe('trial')
    })
    it('trial with the trial over becomes trial_ended', () => {
      expect(computeReferralStatus(state(), snap({ localTrialEnded: true })).status).toBe('trial_ended')
    })
    it('trial_ended whose trial was extended goes back to trial', () => {
      expect(computeReferralStatus(state({ status: 'trial_ended' }), snap()).status).toBe('trial')
    })
    it.each<ReferralStatus>(['first_paid', 'counting', 'paused'])('leaves %s unchanged', (status) => {
      const prev = state({ status, stripeSubscriptionId: 'sub_1' })
      expect(computeReferralStatus(prev, snap({ localTrialEnded: true }))).toEqual(prev)
    })
  })

  describe('R5: dead Stripe subscription', () => {
    const prevs: ReferralState[] = [
      state(),
      state({ status: 'trial_ended' }),
      state({ status: 'first_paid', firstPaidAt: T1 }),
      counting(),
      counting({ status: 'paused', pausedReason: 'past_due' }),
    ]
    for (const status of ['canceled', 'incomplete_expired', 'missing'] as const) {
      it.each(prevs.map((p) => [p.status, p] as const))(`${status} sub: %s becomes canceled`, (_n, prev) => {
        const next = computeReferralStatus(prev, snap({ stripe: stripe({ status }) }))
        expect(next).toMatchObject({ status: 'canceled', pausedReason: null, endedAt: NOW })
      })
    }
  })

  describe('R6: checkout in flight', () => {
    it('incomplete from trial stays trial, stamping the subscription id', () => {
      const next = computeReferralStatus(state(), snap({ stripe: stripe({ status: 'incomplete' }) }))
      expect(next).toEqual(state({ stripeSubscriptionId: 'sub_1' }))
    })
    it('no paid invoice anywhere: unchanged but for the subscription id', () => {
      const next = computeReferralStatus(
        state({ status: 'trial_ended' }),
        snap({ stripe: stripe({ firstPaidAt: null }) }),
      )
      expect(next).toEqual(state({ status: 'trial_ended', stripeSubscriptionId: 'sub_1' }))
    })
  })

  describe('R7: paid subscription', () => {
    it('first paid invoice, no cycle invoice: first_paid with stamps', () => {
      const next = computeReferralStatus(state(), snap({ stripe: stripe() }))
      expect(next).toMatchObject({
        status: 'first_paid',
        firstPaidAt: T1,
        stripeSubscriptionId: 'sub_1',
        qualifiedAt: null,
        qualifyingInvoiceId: null,
      })
    })

    it('paid cycle invoice qualifies: counting with qualification stamps', () => {
      const prev = state({ status: 'first_paid', firstPaidAt: T1, stripeSubscriptionId: 'sub_1' })
      const next = computeReferralStatus(
        prev,
        snap({ stripe: stripe({ qualifyingInvoice: { id: 'in_2', paidAt: T2 } }) }),
      )
      expect(next).toMatchObject({ status: 'counting', qualifiedAt: T2, qualifyingInvoiceId: 'in_2', firstPaidAt: T1 })
    })

    it('1st and 2nd invoice paid before any webhook ran: trial goes straight to counting', () => {
      const next = computeReferralStatus(
        state(),
        snap({ stripe: stripe({ qualifyingInvoice: { id: 'in_2', paidAt: T2 } }) }),
      )
      expect(next.status).toBe('counting')
    })

    it('P-9: qualifying invoice on a yearly sub stays first_paid and does not qualify', () => {
      const next = computeReferralStatus(
        state({ status: 'first_paid', firstPaidAt: T1 }),
        snap({ stripe: stripe({ monthly: false, qualifyingInvoice: { id: 'in_2', paidAt: T2 } }) }),
      )
      expect(next).toMatchObject({ status: 'first_paid', qualifiedAt: null, qualifyingInvoiceId: null })
    })

    it('P-9: counting that moves to yearly shows first_paid and keeps qualifiedAt', () => {
      const next = computeReferralStatus(counting(), snap({ stripe: stripe({ monthly: false }) }))
      expect(next).toMatchObject({ status: 'first_paid', qualifiedAt: T2, pausedReason: null })
    })

    it('does not overwrite an existing firstPaidAt or qualification', () => {
      const prev = counting()
      const next = computeReferralStatus(
        prev,
        snap({
          stripe: stripe({
            firstPaidAt: new Date('2026-08-01T00:00:00Z'),
            qualifyingInvoice: { id: 'in_other', paidAt: NOW },
          }),
        }),
      )
      expect(next).toEqual(prev)
    })

    it.each(['past_due', 'unpaid', 'paused'] as const)('R7b: %s pauses with past_due', (status) => {
      const next = computeReferralStatus(counting(), snap({ stripe: stripe({ status }) }))
      expect(next).toMatchObject({ status: 'paused', pausedReason: 'past_due' })
    })

    it('R7b wins over R7c when both apply', () => {
      const next = computeReferralStatus(
        counting(),
        snap({ stripe: stripe({ status: 'past_due', cancelAtPeriodEnd: true }) }),
      )
      expect(next.pausedReason).toBe('past_due')
    })

    it('past_due then recovery returns to counting and keeps the original qualifiedAt', () => {
      const paused = computeReferralStatus(counting(), snap({ stripe: stripe({ status: 'past_due' }) }))
      const back = computeReferralStatus(
        paused,
        snap({ stripe: stripe({ qualifyingInvoice: { id: 'in_later', paidAt: NOW } }) }),
      )
      expect(back).toMatchObject({ status: 'counting', pausedReason: null, qualifiedAt: T2, qualifyingInvoiceId: 'in_2' })
    })

    it('R7c: cancel at period end pauses, reactivation returns to counting', () => {
      const paused = computeReferralStatus(counting(), snap({ stripe: stripe({ cancelAtPeriodEnd: true }) }))
      expect(paused).toMatchObject({ status: 'paused', pausedReason: 'cancel_scheduled' })
      const back = computeReferralStatus(paused, snap({ stripe: stripe() }))
      expect(back).toMatchObject({ status: 'counting', pausedReason: null })
    })

    it('R7d: trialing counts like active', () => {
      expect(computeReferralStatus(counting(), snap({ stripe: stripe({ status: 'trialing' }) })).status).toBe('counting')
    })

    it('H8: persisted evidence carries a paused referral with an empty invoice snapshot', () => {
      const empty = { firstPaidAt: null, qualifyingInvoice: null }
      expect(
        computeReferralStatus(counting(), snap({ stripe: stripe({ ...empty, status: 'past_due' }) })),
      ).toMatchObject({ status: 'paused', pausedReason: 'past_due' })
      expect(
        computeReferralStatus(counting(), snap({ stripe: stripe({ ...empty, cancelAtPeriodEnd: true }) })),
      ).toMatchObject({ status: 'paused', pausedReason: 'cancel_scheduled' })
    })
  })

  it('is idempotent: applying the same snapshot twice equals once', () => {
    const s = snap({ stripe: stripe({ qualifyingInvoice: { id: 'in_2', paidAt: T2 } }) })
    const once = computeReferralStatus(state(), s)
    expect(computeReferralStatus(once, s)).toEqual(once)
  })

  it('returns an equal but new object when nothing changes, and never mutates prev', () => {
    const prev = counting()
    const frozen = Object.freeze({ ...prev })
    const next = computeReferralStatus(frozen, snap({ stripe: stripe() }))
    expect(next).toEqual(prev)
    expect(next).not.toBe(frozen)
  })
})

describe('status predicates', () => {
  it('isCountingStatus is true only for counting', () => {
    expect(isCountingStatus('counting')).toBe(true)
    expect(isCountingStatus('paused')).toBe(false)
  })
  it('isTerminalStatus covers canceled and ineligible only', () => {
    const all: ReferralStatus[] = ['trial', 'trial_ended', 'first_paid', 'counting', 'paused', 'canceled', 'ineligible']
    expect(all.filter(isTerminalStatus)).toEqual(['canceled', 'ineligible'])
  })
})

describe('referralStatusLabel', () => {
  const l = (status: ReferralStatus, pausedReason: 'past_due' | 'cancel_scheduled' | null = null, ineligibleReason: 'self_referral' | 'not_new' | 'chargeback' | 'admin' | null = null) =>
    referralStatusLabel({ status, pausedReason, ineligibleReason })

  it('matches the pt-BR copy exactly', () => {
    expect(l('trial')).toEqual({ label: 'em teste', sublabel: null })
    expect(l('trial_ended')).toEqual({ label: 'teste encerrado', sublabel: null })
    expect(l('first_paid')).toEqual({ label: 'pagante', sublabel: 'conta a partir da 2ª mensalidade' })
    expect(l('counting')).toEqual({ label: 'pagante', sublabel: null })
    expect(l('paused', 'past_due')).toEqual({ label: 'pagante', sublabel: 'pagamento pendente' })
    expect(l('paused', 'cancel_scheduled')).toEqual({ label: 'pagante', sublabel: 'cancelamento agendado' })
    expect(l('canceled')).toEqual({ label: 'cancelada', sublabel: null })
    expect(l('ineligible', null, 'self_referral')).toEqual({ label: 'não elegível', sublabel: 'mesma clínica ou profissional' })
    expect(l('ineligible', null, 'not_new')).toEqual({ label: 'não elegível', sublabel: 'clínica já usou o FloraClin' })
    expect(l('ineligible', null, 'chargeback')).toEqual({ label: 'não elegível', sublabel: 'contestação de pagamento' })
    expect(l('ineligible', null, 'admin')).toEqual({ label: 'não elegível', sublabel: 'não atende às regras do programa' })
  })
})
