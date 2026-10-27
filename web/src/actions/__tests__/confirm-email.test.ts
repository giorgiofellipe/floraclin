import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CONFIRM_EMAIL_STATE_COOKIE, parseConfirmEmailPageState } from '@/lib/confirm-email-page-state'

const jar = new Map<string, string>()
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { value: jar.get(name) } : undefined),
    set: (name: string, value: string) => jar.set(name, value),
    delete: ({ name }: { name: string }) => jar.delete(name),
  }),
}))

// Same hierarchy as @auth/core/errors: CredentialsSignin is one kind of AuthError.
const { AuthError, CredentialsSignin } = vi.hoisted(() => {
  class AuthError extends Error {}
  class CredentialsSignin extends AuthError {}
  return { AuthError, CredentialsSignin }
})
vi.mock('next-auth', () => ({ AuthError, CredentialsSignin }))

const { signIn } = vi.hoisted(() => ({ signIn: vi.fn() }))
vi.mock('@/lib/auth-config', () => ({ signIn }))

import { confirmEmail } from '../confirm-email'

const pageState = () => parseConfirmEmailPageState(jar.get(CONFIRM_EMAIL_STATE_COOKIE))

beforeEach(() => {
  jar.clear()
  jar.set(CONFIRM_EMAIL_STATE_COOKIE, JSON.stringify({ email: 'ana@clinica.com.br', token: 'raw' }))
  signIn.mockReset()
})

describe('confirmEmail action', () => {
  it('signs in with the address and token from the cookie, not from the caller', async () => {
    await confirmEmail()

    expect(signIn).toHaveBeenCalledWith('confirm-email', {
      email: 'ana@clinica.com.br',
      token: 'raw',
      redirectTo: '/onboarding',
    })
  })

  it('a refused link says so and keeps only the address, so the resend button stays', async () => {
    signIn.mockRejectedValueOnce(new CredentialsSignin())

    expect(await confirmEmail()).toEqual({ error: 'Link inválido ou expirado.' })
    expect(pageState()).toEqual({ email: 'ana@clinica.com.br', token: null })
  })

  it('a failure inside sign-in keeps the token for another try', async () => {
    signIn.mockRejectedValueOnce(new AuthError('db down'))

    expect(await confirmEmail()).toEqual({ error: 'Não foi possível confirmar agora. Tente novamente.' })
    expect(pageState()).toEqual({ email: 'ana@clinica.com.br', token: 'raw' })
  })
})
