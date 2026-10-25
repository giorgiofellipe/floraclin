import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { SignupLink } from '../signup-link'
import { COOKIE_CONSENT_STORAGE_KEY, saveCookieConsent } from '@/lib/cookie-consent'

function consent(marketing: boolean) {
  return JSON.stringify({ necessary: true, marketing, updatedAt: '2026-10-21T00:00:00.000Z', version: 1 })
}

function setLocation(search: string) {
  window.history.replaceState(null, '', `/${search}`)
}

describe('SignupLink', () => {
  beforeEach(() => {
    window.sessionStorage.clear()
    window.localStorage.clear()
  })

  afterEach(() => setLocation(''))

  // Regression: the click id waited for consent, so most ad signups reached CAPI without fbc.
  it('points at the app signup with the ad UTMs and the click id before the banner is answered', async () => {
    setLocation('?utm_source=meta&utm_medium=paid_social&utm_campaign=c1&fbclid=fb-1')
    render(<SignupLink>Começar</SignupLink>)
    const link = await screen.findByRole('link', { name: 'Começar' })
    const href = new URL(link.getAttribute('href')!)
    expect(href.origin + href.pathname).toBe('https://app.floraclin.com.br/signup')
    expect(href.searchParams.get('utm_source')).toBe('meta')
    expect(href.searchParams.get('utm_campaign')).toBe('c1')
    expect(href.searchParams.get('fbclid')).toBe('fb-1')
  })

  it('drops the click id as soon as the banner refuses marketing', async () => {
    setLocation('?utm_source=meta&fbclid=fb-1')
    render(<SignupLink>Começar</SignupLink>)
    const link = await screen.findByRole('link', { name: 'Começar' })
    act(() => {
      saveCookieConsent(false)
    })
    const href = new URL(link.getAttribute('href')!)
    expect(href.searchParams.has('fbclid')).toBe(false)
    expect(href.searchParams.get('utm_source')).toBe('meta')
  })

  it('drops the click id at click time when marketing was refused in another tab', async () => {
    window.localStorage.setItem(COOKIE_CONSENT_STORAGE_KEY, consent(true))
    setLocation('?utm_source=meta&fbclid=fb-1')
    render(<SignupLink>Começar</SignupLink>)
    const link = await screen.findByRole('link', { name: 'Começar' })
    expect(new URL(link.getAttribute('href')!).searchParams.get('fbclid')).toBe('fb-1')
    window.localStorage.setItem(COOKIE_CONSENT_STORAGE_KEY, consent(false))
    link.addEventListener('click', (event) => event.preventDefault())
    fireEvent.click(link)
    expect(new URL(link.getAttribute('href')!).searchParams.has('fbclid')).toBe(false)
  })

  it("still runs the caller's onClick, which closes the mobile menu", async () => {
    const onClick = vi.fn()
    render(<SignupLink onClick={onClick}>Começar</SignupLink>)
    const link = await screen.findByRole('link', { name: 'Começar' })
    link.addEventListener('click', (event) => event.preventDefault())
    fireEvent.click(link)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('stays the bare signup URL for a visit without a campaign', async () => {
    setLocation('')
    render(<SignupLink>Começar</SignupLink>)
    expect((await screen.findByRole('link', { name: 'Começar' })).getAttribute('href')).toBe(
      'https://app.floraclin.com.br/signup',
    )
  })
})
