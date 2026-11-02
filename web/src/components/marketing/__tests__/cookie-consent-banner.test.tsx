/**
 * The cookie banner on the setup, below sm: one row along the bottom edge
 * under the pinned action bar, instead of the floating card stacked on top of
 * it. Layout itself is not something jsdom does; these pin the classes and the
 * variables the action bar reads, and that refusing stays as easy as accepting.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
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
  it('is a compact single row along the bottom edge below sm, the floating card from sm up', () => {
    render(<CookieConsentBanner />)
    const section = banner()
    expect(section).toHaveAttribute('data-compact', 'true')
    expect(section).toHaveClass('bottom-0', 'left-0', 'right-0', 'flex', 'items-center', 'rounded-none')
    // sm and up: the same floating card as on every other route.
    expect(section).toHaveClass('sm:block', 'sm:rounded-2xl', 'sm:p-4', 'md:flex')
    expect(section.className).toMatch(/sm:bottom-\[calc\(1rem\+env\(safe-area-inset-bottom\)\)\]/)
    // The one-row tweaks stop at sm: from there the card wraps and shrinks as on every other route.
    const refuse = screen.getByRole('button', { name: 'Recusar' })
    for (const el of [refuse, screen.getByRole('button', { name: 'Aceitar todos' })]) {
      expect(el).toHaveClass('max-sm:whitespace-nowrap')
      expect(el).not.toHaveClass('whitespace-nowrap')
    }
    expect(refuse.parentElement).toHaveClass('max-sm:shrink-0')
    expect(refuse.parentElement).not.toHaveClass('shrink-0')
    expect(section.firstElementChild).toHaveClass('max-sm:min-w-0')
    expect(section.firstElementChild).not.toHaveClass('min-w-0')
  })

  it('keeps Recusar and Aceitar todos the same size, each a 44px target, with the links reachable', () => {
    render(<CookieConsentBanner />)
    const refuse = screen.getByRole('button', { name: 'Recusar' })
    const accept = screen.getByRole('button', { name: 'Aceitar todos' })
    for (const button of [refuse, accept]) {
      expect(button).toHaveClass('min-h-11', 'px-3', 'text-sm', 'rounded-full')
    }
    // Equal columns: neither is narrower than the other.
    expect(refuse.parentElement).toHaveClass('grid', 'grid-cols-2')
    // Both in the phone copy itself, not only in the sm+ paragraph.
    const phoneCopy = screen.getByRole('button', { name: 'Ver detalhes' }).closest('p')!
    expect(within(phoneCopy).getByRole('link', { name: 'Privacidade' })).toHaveAttribute(
      'href',
      'https://floraclin.com.br/privacidade',
    )
  })

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

describe('CookieConsentBanner elsewhere', () => {
  it('stays the floating card on other routes', () => {
    nav.pathname = '/dashboard'
    render(<CookieConsentBanner />)
    const section = banner()
    expect(section).not.toHaveAttribute('data-compact')
    expect(section).toHaveClass('rounded-xl', 'p-3', 'shadow-2xl')
    expect(section).not.toHaveClass('bottom-0', 'rounded-none')
    expect(screen.getByRole('button', { name: 'Recusar' })).not.toHaveClass('min-h-11')
  })

  it('does not take a route that only starts with the same letters', () => {
    nav.pathname = '/onboarding-old'
    render(<CookieConsentBanner />)
    expect(banner()).not.toHaveAttribute('data-compact')
  })
})
