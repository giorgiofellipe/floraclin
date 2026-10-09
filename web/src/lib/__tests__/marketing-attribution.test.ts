import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { COOKIE_CONSENT_STORAGE_KEY, saveCookieConsent } from '../cookie-consent'
import {
  ATTRIBUTION_STORAGE_KEY,
  PENDING_ATTRIBUTION_SESSION_KEY,
  buildFbc,
  captureFirstTouchAttribution,
  capturePendingFirstTouchAttribution,
  discardMarketingAttribution,
  parseSignupAttribution,
  trackMetaEvent,
} from '../marketing-attribution'

describe('marketing attribution utilities', () => {
  beforeEach(() => {
    window.localStorage.clear()
    window.sessionStorage.clear()
    document.cookie = 'floraclin_ft=; Max-Age=0; Path=/'
    window.history.pushState({}, '', '/signup?utm_source=meta&fbclid=click-1')
    delete window.fbq
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('builds Meta fbc from a click id and timestamp', () => {
    expect(buildFbc('IwAR123', 1700000000000)).toBe('fb.1.1700000000000.IwAR123')
  })

  it('normalizes signup attribution from hidden form JSON', () => {
    const parsed = parseSignupAttribution(
      JSON.stringify({
        utmSource: 'meta',
        utmCampaign: 'hof-trial',
        fbclid: 'click-1',
        ignored: 'nope',
        capturedAt: '2026-10-06T00:00:00.000Z',
        expiresAt: '2027-01-04T00:00:00.000Z',
        metaEventId: 'complete_registration:event-1',
      }),
    )

    expect(parsed).toEqual({
      utmSource: 'meta',
      utmCampaign: 'hof-trial',
      fbclid: 'click-1',
      capturedAt: '2026-10-06T00:00:00.000Z',
      expiresAt: '2027-01-04T00:00:00.000Z',
      metaEventId: 'complete_registration:event-1',
    })
  })

  it('buffers first-touch attribution in session storage before marketing consent', () => {
    expect(captureFirstTouchAttribution()).toBeNull()
    expect(window.localStorage.getItem(ATTRIBUTION_STORAGE_KEY)).toBeNull()
    expect(window.sessionStorage.getItem(PENDING_ATTRIBUTION_SESSION_KEY)).toContain('click-1')
  })

  it('persists buffered first-touch attribution after marketing consent is granted', () => {
    capturePendingFirstTouchAttribution()
    window.history.pushState({}, '', '/signup')
    saveCookieConsent(true)

    const attribution = captureFirstTouchAttribution()

    expect(attribution).toMatchObject({
      utmSource: 'meta',
      fbclid: 'click-1',
      fbc: expect.stringMatching(/^fb\.1\.\d+\.click-1$/),
    })
    expect(window.localStorage.getItem(ATTRIBUTION_STORAGE_KEY)).toContain('click-1')
    expect(window.sessionStorage.getItem(PENDING_ATTRIBUTION_SESSION_KEY)).toBeNull()
    expect(window.localStorage.getItem(COOKIE_CONSENT_STORAGE_KEY)).toContain('"marketing":true')
  })

  it('discards buffered attribution when marketing consent is rejected', () => {
    capturePendingFirstTouchAttribution()

    discardMarketingAttribution()

    expect(window.sessionStorage.getItem(PENDING_ATTRIBUTION_SESSION_KEY)).toBeNull()
    expect(window.localStorage.getItem(ATTRIBUTION_STORAGE_KEY)).toBeNull()
  })

  it('does not send Meta events after marketing consent is revoked', () => {
    const fbq = vi.fn()
    window.fbq = fbq as typeof window.fbq

    saveCookieConsent(false)
    trackMetaEvent('CompleteRegistration')

    expect(fbq).toHaveBeenCalledWith('consent', 'revoke')
    expect(fbq).not.toHaveBeenCalledWith('track', 'CompleteRegistration', {}, undefined)
  })

  it('retries one-shot Meta events until the pixel bootstrap defines fbq', async () => {
    vi.useFakeTimers()
    saveCookieConsent(true)

    trackMetaEvent('CompleteRegistration', { status: 'trial_started' }, 'complete-registration:event-1')

    const fbq = vi.fn()
    window.fbq = fbq as typeof window.fbq

    await vi.advanceTimersByTimeAsync(100)

    expect(fbq).toHaveBeenCalledWith(
      'track',
      'CompleteRegistration',
      { status: 'trial_started' },
      { eventID: 'complete-registration:event-1' },
    )
  })

  it('does not retry Meta events after marketing consent is revoked before fbq is ready', async () => {
    vi.useFakeTimers()
    saveCookieConsent(true)

    trackMetaEvent('Subscribe', { value: 99, currency: 'BRL' }, 'subscribe:session-1')
    saveCookieConsent(false)

    const fbq = vi.fn()
    window.fbq = fbq as typeof window.fbq

    await vi.advanceTimersByTimeAsync(100)

    expect(fbq).not.toHaveBeenCalledWith(
      'track',
      'Subscribe',
      { value: 99, currency: 'BRL' },
      { eventID: 'subscribe:session-1' },
    )
  })
})
