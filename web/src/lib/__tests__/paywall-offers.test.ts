import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/feedback-offer', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/feedback-offer')>()),
  getValidatedFeedbackOffer: vi.fn(),
}))
vi.mock('@/lib/winback-offer', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/winback-offer')>()),
  getValidatedWinbackOffer: vi.fn(),
}))
vi.mock('@/lib/referral/offer', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/referral/offer')>()),
  getValidatedReferralOffer: vi.fn(),
}))

import { getValidatedFeedbackOffer } from '@/lib/feedback-offer'
import { getValidatedWinbackOffer } from '@/lib/winback-offer'
import { getValidatedReferralOffer } from '@/lib/referral/offer'
import { paywallOffer, pickOffers } from '../paywall-offers'

// Checkout's precedence: feedback, then win-back, then referral, and a lower
// offer is never looked up once a higher one validates.

const FEEDBACK = { kind: 'feedback' }
const WINBACK = { kind: 'winback' }
const REFERRAL = { kind: 'referral' }

function lookups(feedback: unknown, winback: unknown, referral: unknown) {
  return {
    feedback: vi.fn(async () => feedback),
    winback: vi.fn(async () => winback),
    referral: vi.fn(async () => referral),
  }
}

describe('pickOffers', () => {
  it('returns the feedback offer and never looks up win-back or referral', async () => {
    const l = lookups(FEEDBACK, WINBACK, REFERRAL)
    expect(await pickOffers(l)).toBe(FEEDBACK)
    expect(l.winback).not.toHaveBeenCalled()
    expect(l.referral).not.toHaveBeenCalled()
  })

  it('falls back to win-back when the feedback offer does not validate, skipping referral', async () => {
    const l = lookups(null, WINBACK, REFERRAL)
    expect(await pickOffers(l)).toBe(WINBACK)
    expect(l.referral).not.toHaveBeenCalled()
  })

  it('falls back to referral when neither feedback nor win-back validates', async () => {
    expect(await pickOffers(lookups(null, null, REFERRAL))).toBe(REFERRAL)
  })

  it('treats a lookup that does not apply (null) as no offer', async () => {
    expect(await pickOffers({ feedback: null, winback: null, referral: async () => REFERRAL })).toBe(REFERRAL)
    expect(await pickOffers({ feedback: null, winback: null, referral: null })).toBeNull()
  })
})

// The platform layout shows exactly what paywallOffer returns.
describe('paywallOffer', () => {
  const NOW = new Date('2026-10-30T12:00:00.000Z')
  const terms = { percentOff: 50, amountOffCents: null, duration: 'repeating' as const, durationInMonths: 3, planSlugs: ['pro'] }
  const validatedFeedback = { kind: 'feedback' as const, promotionCodeId: 'promo_feedback', label: '50%', ...terms }
  const validatedWinback = { kind: 'winback' as const, promotionCodeId: 'promo_winback', endsAt: NOW.toISOString(), label: '30%', ...terms }
  const validatedReferral = { kind: 'referral' as const, promotionCodeId: 'promo_ref', referralId: 'ref-1', referrerName: 'Bela', label: '20%', ...terms }

  beforeEach(() => {
    vi.mocked(getValidatedFeedbackOffer).mockReset().mockResolvedValue(validatedFeedback)
    vi.mocked(getValidatedWinbackOffer).mockReset().mockResolvedValue(validatedWinback)
    vi.mocked(getValidatedReferralOffer).mockReset().mockResolvedValue(validatedReferral)
  })

  it.each([
    ['the expired paywall', { readOnly: true, trialEnding: false }],
    ['the trial-ending modal', { readOnly: false, trialEnding: true }],
  ])('shows the feedback offer on %s, without the promotion code id', async (_name, view) => {
    const offer = await paywallOffer(null, [], NOW, { ...view, recovery: 'checkout' })

    expect(offer).toEqual({ kind: 'feedback', label: '50%', ...terms })
    expect(JSON.stringify(offer)).not.toContain('promo_')
  })

  it('never offers the win-back while the trial is still running', async () => {
    vi.mocked(getValidatedFeedbackOffer).mockResolvedValue(null)

    const offer = await paywallOffer(null, [], NOW, { readOnly: false, trialEnding: true, recovery: 'checkout' })

    expect(getValidatedWinbackOffer).not.toHaveBeenCalled()
    expect(offer?.kind).toBe('referral')
  })

  it('offers nothing while the way back is fixing the card', async () => {
    expect(await paywallOffer(null, [], NOW, { readOnly: true, trialEnding: false, recovery: 'payment_update' })).toBeNull()
    expect(getValidatedFeedbackOffer).not.toHaveBeenCalled()
  })
})
