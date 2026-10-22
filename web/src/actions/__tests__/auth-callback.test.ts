import { beforeEach, describe, expect, it, vi } from 'vitest'

const { signInMock } = vi.hoisted(() => ({ signInMock: vi.fn() }))

vi.mock('next-auth', () => ({ AuthError: class AuthError extends Error {} }))
vi.mock('@/lib/auth-config', () => ({ signIn: signInMock, signOut: vi.fn() }))
vi.mock('next/navigation', () => ({ redirect: vi.fn() }))

import { login, loginWithGoogle } from '../auth'

function form(fields: Record<string, string>) {
  const data = new FormData()
  for (const [key, value] of Object.entries(fields)) data.set(key, value)
  return data
}

beforeEach(() => signInMock.mockReset())

describe('sign-in honours callbackUrl', () => {
  it('sends a password sign-in to the callbackUrl', async () => {
    await login(null, form({ email: 'a@b.com', password: 'x', callbackUrl: '/onboarding?utm_source=lifecycle' }))
    expect(signInMock).toHaveBeenCalledWith('credentials', expect.objectContaining({
      redirectTo: '/onboarding?utm_source=lifecycle',
    }))
  })

  it('sends a Google sign-in to the callbackUrl', async () => {
    await loginWithGoogle(form({ callbackUrl: '/onboarding' }))
    expect(signInMock).toHaveBeenCalledWith('google', { redirectTo: '/onboarding' })
  })

  it('falls back to /dashboard for an off-site callbackUrl', async () => {
    await loginWithGoogle(form({ callbackUrl: '//evil.example/x' }))
    expect(signInMock).toHaveBeenCalledWith('google', { redirectTo: '/dashboard' })
  })

  it('falls back to /dashboard with no callbackUrl', async () => {
    await login(null, form({ email: 'a@b.com', password: 'x' }))
    expect(signInMock).toHaveBeenCalledWith('credentials', expect.objectContaining({ redirectTo: '/dashboard' }))
  })
})
