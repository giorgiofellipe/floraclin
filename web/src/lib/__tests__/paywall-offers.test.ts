import { describe, expect, it, vi } from 'vitest'
import { pickOffers } from '../paywall-offers'

// The layout's precedence: a validated feedback offer hides win-back and
// referral (and skips their Stripe lookups); without it, win-back, then referral.

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
  it('returns only the feedback offer and never looks up win-back or referral', async () => {
    const l = lookups(FEEDBACK, WINBACK, REFERRAL)
    expect(await pickOffers(l)).toEqual({ feedback: FEEDBACK, winback: null, referral: null })
    expect(l.winback).not.toHaveBeenCalled()
    expect(l.referral).not.toHaveBeenCalled()
  })

  it('falls back to win-back when the feedback offer does not validate, skipping referral', async () => {
    const l = lookups(null, WINBACK, REFERRAL)
    expect(await pickOffers(l)).toEqual({ feedback: null, winback: WINBACK, referral: null })
    expect(l.referral).not.toHaveBeenCalled()
  })

  it('falls back to referral when neither feedback nor win-back validates', async () => {
    const l = lookups(null, null, REFERRAL)
    expect(await pickOffers(l)).toEqual({ feedback: null, winback: null, referral: REFERRAL })
  })

  it('skips the lookups that do not apply (a running trial has no win-back)', async () => {
    const referral = vi.fn(async () => REFERRAL)
    expect(await pickOffers({ feedback: null, winback: null, referral })).toEqual({
      feedback: null,
      winback: null,
      referral: REFERRAL,
    })
  })
})
