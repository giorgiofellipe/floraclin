import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { SignupLink } from '../signup-link'

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
  it('points at the app signup with the ad UTMs and the click id', async () => {
    setLocation('?utm_source=meta&utm_medium=paid_social&utm_campaign=c1&fbclid=fb-1')
    render(<SignupLink>Começar</SignupLink>)
    const link = await screen.findByRole('link', { name: 'Começar' })
    const href = new URL(link.getAttribute('href')!)
    expect(href.origin + href.pathname).toBe('https://app.floraclin.com.br/signup')
    expect(href.searchParams.get('utm_source')).toBe('meta')
    expect(href.searchParams.get('utm_campaign')).toBe('c1')
    expect(href.searchParams.get('fbclid')).toBe('fb-1')
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
