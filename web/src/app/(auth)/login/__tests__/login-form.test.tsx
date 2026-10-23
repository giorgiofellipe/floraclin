import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { track } from '@/lib/analytics/client'
import { LoginForm } from '../login-form'

vi.mock('@/actions/auth', () => ({
  login: vi.fn(async () => ({ error: { general: ['E-mail ou senha inválidos'] } })),
  loginWithGoogle: vi.fn(),
}))

vi.mock('@/lib/analytics/client', () => ({ track: vi.fn() }))

afterEach(() => vi.clearAllMocks())

describe('LoginForm analytics', () => {
  it('reports a refused password as invalid_credentials, without the address', async () => {
    const user = userEvent.setup()
    render(<LoginForm inAppBrowser={null} callbackUrl={null} authError={null} />)

    await user.type(screen.getByTestId('login-email'), 'ana@example.com')
    await user.type(screen.getByTestId('login-password'), 'wrong-password')
    await user.click(screen.getByTestId('login-submit'))
    await screen.findByTestId('login-error')

    expect(vi.mocked(track).mock.calls).toEqual([
      ['login_failed', { method: 'email', reason: 'invalid_credentials', in_app_browser: false }],
    ])
    expect(JSON.stringify(vi.mocked(track).mock.calls)).not.toContain('ana@example.com')
  })

  it('reports the Auth.js error the page was sent back with, once', () => {
    const { rerender } = render(
      <LoginForm
        inAppBrowser={{ app: 'whatsapp', os: 'android' }}
        callbackUrl={null}
        authError="O login com Google não foi concluído."
        authFailure={{ method: 'google', reason: 'oauth_error' }}
      />,
    )
    rerender(
      <LoginForm
        inAppBrowser={{ app: 'whatsapp', os: 'android' }}
        callbackUrl={null}
        authError="O login com Google não foi concluído."
        authFailure={{ method: 'google', reason: 'oauth_error' }}
      />,
    )

    expect(vi.mocked(track).mock.calls).toEqual([
      ['login_failed', { method: 'google', reason: 'oauth_error', in_app_browser: true, in_app_browser_name: 'whatsapp' }],
    ])
  })

  it('counts a Google tap inside an in-app browser as blocked (disallowed_useragent), naming the app', async () => {
    const user = userEvent.setup()
    render(<LoginForm inAppBrowser={{ app: 'instagram', os: 'ios' }} callbackUrl={null} authError={null} />)

    await user.click(screen.getByTestId('google-sign-in'))

    expect(vi.mocked(track)).toHaveBeenCalledWith('login_failed', {
      method: 'google',
      reason: 'disallowed_useragent',
      in_app_browser: true,
      in_app_browser_name: 'instagram',
    })
  })

  it('does not report a Google tap in a normal browser as a failure', async () => {
    const user = userEvent.setup()
    render(<LoginForm inAppBrowser={null} callbackUrl={null} authError={null} />)
    await user.click(screen.getByTestId('google-sign-in'))
    expect(track).not.toHaveBeenCalled()
  })
})
