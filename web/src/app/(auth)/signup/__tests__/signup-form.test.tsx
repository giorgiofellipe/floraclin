import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { track } from '@/lib/analytics/client'
import { SignUpForm } from '../signup-form'

vi.mock('@/actions/signup', () => ({
  signUp: vi.fn(async () => null),
  signUpWithGoogle: vi.fn(),
}))

vi.mock('@/lib/analytics/client', () => ({ track: vi.fn() }))

afterEach(() => vi.clearAllMocks())

describe('SignUpForm analytics', () => {
  it('reports signup_started once per method, with the first-touch UTMs', async () => {
    const user = userEvent.setup()
    render(<SignUpForm inAppBrowser={null} utm={{ utm_source: 'instagram', utm_campaign: 'launch' }} />)

    await user.type(screen.getByLabelText('Nome completo'), 'Ana Souza')
    await user.type(screen.getByLabelText('E-mail'), 'ana@example.com')
    fireEvent.submit(screen.getByRole('button', { name: 'Criar conta' }).closest('form')!)
    await user.click(screen.getByTestId('google-sign-in'))

    expect(vi.mocked(track).mock.calls).toEqual([
      ['signup_started', { method: 'email', utm_source: 'instagram', utm_campaign: 'launch', in_app_browser: false }],
      ['signup_started', { method: 'google', utm_source: 'instagram', utm_campaign: 'launch', in_app_browser: false }],
    ])
  })
})
