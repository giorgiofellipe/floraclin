import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { COOKIE_CONSENT_COOKIE_NAME, saveCookieConsent } from '../cookie-consent'
import { buildFbc, trackMetaEvent } from '../marketing-attribution'

describe('marketing attribution utilities', () => {
  beforeEach(() => {
    window.localStorage.clear()
    document.cookie = `${COOKIE_CONSENT_COOKIE_NAME}=; Max-Age=0; Path=/`
    delete window.fbq
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('builds Meta fbc from a click id and timestamp', () => {
    expect(buildFbc('IwAR123', 1700000000000)).toBe('fb.1.1700000000000.IwAR123')
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
