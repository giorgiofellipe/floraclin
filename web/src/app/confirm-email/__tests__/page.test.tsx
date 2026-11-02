/**
 * Regression: the page trusted the token's emailVerified claim, minted at
 * sign-in and never refreshed, so an owner who had confirmed (in another
 * browser) kept being shown "Confirme seu e-mail". The database decides now.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

const { session, verified, cookie } = vi.hoisted(() => ({
  session: { current: null as null | Record<string, unknown> },
  verified: { current: false },
  cookie: { current: undefined as string | undefined },
}))

vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`redirect:${url}`)
  },
}))
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => (cookie.current ? { value: cookie.current } : undefined) }),
}))
vi.mock('@/lib/auth-config', () => ({ auth: vi.fn(async () => session.current) }))
vi.mock('@/db/queries/users', () => ({ isUserEmailVerified: vi.fn(async () => verified.current) }))
vi.mock('@/components/analytics/analytics-provider', () => ({ AnalyticsProvider: () => null }))
vi.mock('../signup-conversion-tracker', () => ({ SignupConversionTracker: () => null }))
vi.mock('../confirm-actions', () => ({
  ConfirmActions: (props: { email: string; hasToken: boolean; signedIn: boolean }) => (
    <div data-testid="actions">{JSON.stringify(props)}</div>
  ),
}))
vi.mock('../request-confirmation-form', () => ({ RequestConfirmationForm: () => <div data-testid="request-form" /> }))

import ConfirmEmailPage from '../page'

const renderPage = async () => render(await ConfirmEmailPage({ searchParams: Promise.resolve({}) }))

beforeEach(() => {
  session.current = null
  verified.current = false
  cookie.current = undefined
})

describe('/confirm-email', () => {
  it('sends a confirmed owner on to onboarding even when the token still says unconfirmed', async () => {
    session.current = { user: { id: 'u1', email: 'ana@clinica.test' }, emailVerified: false }
    verified.current = true
    await expect(renderPage()).rejects.toThrow('redirect:/onboarding')
  })

  it('shows the one-tap confirm state when the link brought a token', async () => {
    cookie.current = JSON.stringify({ email: 'ana@clinica.test', token: 'raw' })
    await renderPage()
    expect(screen.getByText('Falta só um toque')).toBeInTheDocument()
    expect(JSON.parse(screen.getByTestId('actions').textContent!)).toMatchObject({ hasToken: true, signedIn: false })
  })

  it('offers the way back into the setup to a signed-in, unconfirmed owner', async () => {
    session.current = { user: { id: 'u1', email: 'ana@clinica.test' }, emailVerified: false }
    await renderPage()
    expect(screen.getByText('Confirme seu e-mail')).toBeInTheDocument()
    expect(JSON.parse(screen.getByTestId('actions').textContent!)).toMatchObject({
      email: 'ana@clinica.test',
      hasToken: false,
      signedIn: true,
    })
  })
})
