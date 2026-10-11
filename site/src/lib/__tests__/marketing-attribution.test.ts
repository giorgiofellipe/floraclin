import { beforeEach, describe, expect, it } from 'vitest'
import { COOKIE_CONSENT_COOKIE_NAME, saveCookieConsent } from '../cookie-consent'
import { SIGNUP_URL, captureFirstTouchAttribution, signupUrlWithPendingAttribution } from '../marketing-attribution'

describe('signupUrlWithPendingAttribution', () => {
  beforeEach(() => {
    window.localStorage.clear()
    window.sessionStorage.clear()
    document.cookie = `${COOKIE_CONSENT_COOKIE_NAME}=; Max-Age=0; Path=/`
    window.history.pushState({}, '', '/?utm_source=meta&utm_campaign=hof&fbclid=click-1')
  })

  it('carries attribution buffered before consent to the app signup link', () => {
    captureFirstTouchAttribution()
    window.history.pushState({}, '', '/precos')

    const url = new URL(signupUrlWithPendingAttribution())

    expect(`${url.origin}${url.pathname}`).toBe(SIGNUP_URL)
    expect(url.searchParams.get('utm_source')).toBe('meta')
    expect(url.searchParams.get('utm_campaign')).toBe('hof')
    expect(url.searchParams.get('fbclid')).toBe('click-1')
  })

  it('links to the bare signup URL after marketing consent was denied', () => {
    saveCookieConsent(false)
    captureFirstTouchAttribution()

    expect(signupUrlWithPendingAttribution()).toBe(SIGNUP_URL)
  })
})
