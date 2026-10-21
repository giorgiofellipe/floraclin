import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { SignupLink } from '../signup-link'
import { COOKIE_CONSENT_STORAGE_KEY } from '@/lib/cookie-consent'

function setLocation(search: string) {
  window.history.replaceState(null, '', `/${search}`)
}

describe('SignupLink', () => {
  beforeEach(() => {
    window.sessionStorage.clear()
    window.localStorage.clear()
  })

  afterEach(() => setLocation(''))

  it('points at the app signup with the ad UTMs once mounted', async () => {
    setLocation('?utm_source=meta&utm_medium=paid_social&utm_campaign=c1&fbclid=fb-1')
    render(<SignupLink>Começar</SignupLink>)
    const link = await screen.findByRole('link', { name: 'Começar' })
    const href = new URL(link.getAttribute('href')!)
    expect(href.origin + href.pathname).toBe('https://app.floraclin.com.br/signup')
    expect(href.searchParams.get('utm_source')).toBe('meta')
    expect(href.searchParams.get('utm_campaign')).toBe('c1')
    expect(href.searchParams.has('fbclid')).toBe(false)
  })

  it('adds the click id at click time when marketing consent was granted after mount', async () => {
    setLocation('?utm_source=meta&fbclid=fb-1')
    render(<SignupLink>Começar</SignupLink>)
    const link = await screen.findByRole('link', { name: 'Começar' })
    window.localStorage.setItem(
      COOKIE_CONSENT_STORAGE_KEY,
      JSON.stringify({ necessary: true, marketing: true, updatedAt: '2026-10-21T00:00:00.000Z', version: 1 }),
    )
    link.addEventListener('click', (event) => event.preventDefault())
    fireEvent.click(link)
    expect(new URL(link.getAttribute('href')!).searchParams.get('fbclid')).toBe('fb-1')
  })

  it('stays the bare signup URL for a visit without a campaign', async () => {
    setLocation('')
    render(<SignupLink>Começar</SignupLink>)
    expect((await screen.findByRole('link', { name: 'Começar' })).getAttribute('href')).toBe(
      'https://app.floraclin.com.br/signup',
    )
  })
})
