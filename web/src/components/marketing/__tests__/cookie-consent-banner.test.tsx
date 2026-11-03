/**
 * The cookie banner on the setup, below sm: one row along the bottom edge
 * under the pinned action bar, instead of the floating card stacked on top of
 * it. Layout itself is not something jsdom does; these pin the variables the
 * action bar reads, and that refusing stays as easy as accepting.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { COOKIE_CONSENT_STORAGE_KEY } from '@/lib/cookie-consent'

const nav = vi.hoisted(() => ({ pathname: '/onboarding' }))

vi.mock('next/navigation', () => ({ usePathname: () => nav.pathname }))

import { CookieConsentBanner } from '../cookie-consent-banner'

class ResizeObserverStub {
  constructor(private readonly callback: ResizeObserverCallback) {}
  observe() {
    this.callback([], this as unknown as ResizeObserver)
  }
  disconnect() {}
  unobserve() {}
}

beforeEach(() => {
  window.localStorage.clear()
  document.cookie = 'floraclin_cookie_consent=; Max-Age=0; Path=/'
  vi.stubGlobal('ResizeObserver', ResizeObserverStub)
  nav.pathname = '/onboarding'
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function banner() {
  return screen.getByRole('region', { name: 'Aviso de cookies' })
}

describe('CookieConsentBanner on the setup', () => {
  it('tells the action bar where to sit and that the home-indicator inset is covered', () => {
    const { unmount } = render(<CookieConsentBanner />)
    const root = document.documentElement
    expect(root.style.getPropertyValue('--cookie-banner-offset')).toMatch(/px$/)
    expect(root.style.getPropertyValue('--cookie-banner-safe-area')).toBe('0px')

    unmount()
    expect(root.style.getPropertyValue('--cookie-banner-offset')).toBe('')
    expect(root.style.getPropertyValue('--cookie-banner-safe-area')).toBe('')
  })

  it('refusing records the choice and hides the banner', async () => {
    const user = userEvent.setup()
    render(<CookieConsentBanner />)
    await user.click(screen.getByRole('button', { name: 'Recusar' }))
    expect(JSON.parse(window.localStorage.getItem(COOKIE_CONSENT_STORAGE_KEY)!)).toMatchObject({ marketing: false })
    expect(screen.queryByRole('region', { name: 'Aviso de cookies' })).toBeNull()
  })
})

describe('CookieConsentBanner routes', () => {
  it.each([
    ['/onboarding', true],
    ['/onboarding/equipe', true],
    ['/onboarding-old', false],
    ['/dashboard', false],
  ])('%s compact: %s', (pathname, compact) => {
    nav.pathname = pathname
    render(<CookieConsentBanner />)
    expect(banner().hasAttribute('data-compact')).toBe(compact)
  })
})
