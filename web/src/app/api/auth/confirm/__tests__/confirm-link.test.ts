// @vitest-environment node
/**
 * Regression: an owner who clicked the confirmation link landed on
 * /confirm-email again (it looks like the "check your inbox" screen) and
 * signed in by hand. A click from the browser holding that address's session
 * now confirms and goes straight to /onboarding; a click without one (a mail
 * scanner, another device) still only renders, so the token is never spent in
 * transit.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const { authMock, signInMock, isUserEmailVerifiedMock, reportMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  signInMock: vi.fn(),
  isUserEmailVerifiedMock: vi.fn(),
  reportMock: vi.fn(),
}))

vi.mock('@/lib/auth-config', () => ({ auth: authMock, signIn: signInMock }))
vi.mock('@/db/queries/users', () => ({ isUserEmailVerified: isUserEmailVerifiedMock }))
vi.mock('@/lib/observability', () => ({ reportSideEffectFailure: reportMock }))
vi.mock('next-auth', () => ({
  CredentialsSignin: class CredentialsSignin extends Error {},
}))
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error('NEXT_REDIRECT'), { digest: `NEXT_REDIRECT;replace;${url};307;` })
  },
}))

import { CredentialsSignin } from 'next-auth'
import { GET } from '../route'

const LINK = 'https://app.floraclin.com.br/api/auth/confirm?email=Ana%40Clinica.com&token=raw123'

function redirectError(url: string) {
  return Object.assign(new Error('NEXT_REDIRECT'), { digest: `NEXT_REDIRECT;replace;${url};307;` })
}

async function digestOf(promise: Promise<unknown>): Promise<string | null> {
  try {
    await promise
    return null
  } catch (error) {
    return (error as { digest?: string }).digest ?? null
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  signInMock.mockImplementation(async (_provider: string, options: { redirectTo: string }) => {
    throw redirectError(options.redirectTo)
  })
})

describe('GET /api/auth/confirm from the signed-in owner', () => {
  it('confirms with the token and goes straight to onboarding', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', email: 'ana@clinica.com' } })

    const digest = await digestOf(GET(new NextRequest(LINK)))

    expect(signInMock).toHaveBeenCalledWith('confirm-email', {
      email: 'Ana@Clinica.com',
      token: 'raw123',
      redirectTo: '/onboarding',
    })
    expect(digest).toContain(';/onboarding;')
  })

  it('goes on to onboarding when the link was already used but the address is confirmed', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', email: 'ana@clinica.com' } })
    signInMock.mockRejectedValue(new CredentialsSignin())
    isUserEmailVerifiedMock.mockResolvedValue(true)

    const digest = await digestOf(GET(new NextRequest(LINK)))

    expect(isUserEmailVerifiedMock).toHaveBeenCalledWith('u1')
    expect(digest).toContain(';/onboarding;')
  })

  it('falls back to the confirm page with the token when the link is dead and the address unconfirmed', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', email: 'ana@clinica.com' } })
    signInMock.mockRejectedValue(new CredentialsSignin())
    isUserEmailVerifiedMock.mockResolvedValue(false)

    const response = await GET(new NextRequest(LINK))

    expect(new URL(response.headers.get('location')!).pathname).toBe('/confirm-email')
    expect(response.cookies.get('floraclin_confirm_email')?.value).toContain('raw123')
  })

  it('falls back to the confirm page, and reports it, when the sign-in breaks', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', email: 'ana@clinica.com' } })
    const outage = new Error('db down')
    signInMock.mockRejectedValue(outage)

    const response = await GET(new NextRequest(LINK))

    expect(new URL(response.headers.get('location')!).pathname).toBe('/confirm-email')
    expect(reportMock).toHaveBeenCalledWith(outage, expect.objectContaining({ area: 'signup' }))
  })
})

describe('GET /api/auth/confirm without the owner session (scanner, other device)', () => {
  it('never consumes the token without a session', async () => {
    authMock.mockResolvedValue(null)

    const response = await GET(new NextRequest(LINK))

    expect(signInMock).not.toHaveBeenCalled()
    expect(new URL(response.headers.get('location')!).pathname).toBe('/confirm-email')
  })

  it('never consumes the token with the session of another address', async () => {
    authMock.mockResolvedValue({ user: { id: 'u2', email: 'someone-else@clinica.com' } })

    const response = await GET(new NextRequest(LINK))

    expect(signInMock).not.toHaveBeenCalled()
    expect(new URL(response.headers.get('location')!).pathname).toBe('/confirm-email')
  })
})
