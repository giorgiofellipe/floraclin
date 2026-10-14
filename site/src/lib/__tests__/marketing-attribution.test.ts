import { beforeEach, describe, expect, it } from 'vitest'
import { COOKIE_CONSENT_COOKIE_NAME, saveCookieConsent } from '../cookie-consent'
import { SIGNUP_URL, captureFirstTouchAttribution, signupUrlWithPendingAttribution } from '../marketing-attribution'

describe('signupUrlWithPendingAttribution', () => {
  beforeEach(() => {
    window.localStorage.clear()
    window.sessionStorage.clear()
    document.cookie = `${COOKIE_CONSENT_COOKIE_NAME}=; Max-Age=0; Path=/`
    document.cookie = `floraclin_ft_client=; Max-Age=0; Path=/`
    window.history.pushState({}, '', '/?utm_source=meta&utm_campaign=hof&utm_content=headline-a&fbclid=click-1')
  })

  it('carries first-party attribution to the app signup link before consent', () => {
    captureFirstTouchAttribution()
    window.history.pushState({}, '', '/precos')

    const url = new URL(signupUrlWithPendingAttribution())

    expect(`${url.origin}${url.pathname}`).toBe(SIGNUP_URL)
    expect(url.searchParams.get('utm_source')).toBe('meta')
    expect(url.searchParams.get('utm_campaign')).toBe('hof')
    expect(url.searchParams.get('utm_content')).toBe('headline-a')
    expect(url.searchParams.get('fbclid')).toBe('click-1')
    expect(url.searchParams.get('landing_path')).toBe('/')
  })

  it('keeps internal signup attribution after marketing consent was denied', () => {
    saveCookieConsent(false)
    captureFirstTouchAttribution()

    const url = new URL(signupUrlWithPendingAttribution())
    expect(url.searchParams.get('utm_source')).toBe('meta')
    expect(url.searchParams.get('utm_campaign')).toBe('hof')
  })

  it('preserves the first touch when a later page has different params', () => {
    captureFirstTouchAttribution()
    window.history.pushState({}, '', '/precos?utm_source=google&utm_campaign=later&gclid=click-2')
    captureFirstTouchAttribution()

    const url = new URL(signupUrlWithPendingAttribution())
    expect(url.searchParams.get('utm_source')).toBe('meta')
    expect(url.searchParams.get('utm_campaign')).toBe('hof')
    expect(url.searchParams.get('fbclid')).toBe('click-1')
    expect(url.searchParams.get('gclid')).toBe('click-2')
  })
})
