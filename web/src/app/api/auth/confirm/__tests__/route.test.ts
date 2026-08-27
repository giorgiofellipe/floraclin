/**
 * Covers the email-confirmation surface end to end:
 *
 * - GET /api/auth/confirm renders (redirects to the confirm-email page)
 *   and never consumes the token itself -- a mail scanner following the
 *   link must not burn it before the recipient clicks.
 * - POST /api/auth/confirm consumes: a valid token verifies, an expired or
 *   replayed one fails.
 * - POST /api/auth/confirm/resend is throttled by a conditional UPDATE and
 *   never reveals whether an address has an account or is already verified.
 * - The auth-config jwt callback stamps emailVerified once a Google account
 *   is persisted, both for a brand-new user and for one linking into an
 *   existing unconfirmed credentials account. This lives here (rather than
 *   its own file) because the confirm surface is the one place in this task
 *   allowed to add a test file, and `pnpm exec vitest run web/src/app/api/auth`
 *   is the command that has to cover it.
 *
 * All DB access is mocked -- no network or database access occurs.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

// ─── Mocks (hoisted by vitest) ────────────────────────────────────────

const { selectQueue, updateQueue, pushSelect, pushUpdate, dbMock } = vi.hoisted(() => {
  const selectQueue: unknown[] = []
  const updateQueue: unknown[] = []

  // Generic chain: every method but the terminal one returns the chain
  // itself, so it works for `.select().from().where().limit()` and for
  // `.select().from().innerJoin().innerJoin().where().limit()` alike.
  const selectChain: Record<string, unknown> = {}
  selectChain.from = () => selectChain
  selectChain.innerJoin = () => selectChain
  selectChain.where = () => selectChain
  selectChain.limit = () => Promise.resolve(selectQueue.shift() ?? [])

  const updateChain: Record<string, unknown> = {}
  updateChain.set = () => updateChain
  updateChain.where = () => updateChain
  updateChain.returning = () => Promise.resolve(updateQueue.shift() ?? [])

  return {
    selectQueue,
    updateQueue,
    pushSelect: (v: unknown) => selectQueue.push(v),
    pushUpdate: (v: unknown) => updateQueue.push(v),
    dbMock: {
      select: vi.fn(() => selectChain),
      update: vi.fn(() => updateChain),
    },
  }
})

vi.mock('@/db/client', () => ({ db: dbMock }))

vi.mock('@/db/schema', () => ({
  users: { id: 'id', email: 'email', emailVerified: 'email_verified', isPlatformAdmin: 'is_platform_admin' },
  verificationTokens: { identifier: 'identifier', token: 'token', lastSentAt: 'last_sent_at' },
  tenantUsers: { tenantId: 'tenant_id', userId: 'user_id', role: 'role', isActive: 'is_active' },
  tenants: { id: 'id', name: 'name', status: 'status', deletedAt: 'deleted_at' },
  tenantSubscriptions: { tenantId: 'tenant_id', planId: 'plan_id', status: 'status' },
  plans: { id: 'id', slug: 'slug', features: 'features' },
  sessions: {},
  accounts: {},
}))

const { consumeConfirmationTokenMock, markEmailVerifiedMock, issueConfirmationTokenMock } = vi.hoisted(() => ({
  consumeConfirmationTokenMock: vi.fn(),
  markEmailVerifiedMock: vi.fn(),
  issueConfirmationTokenMock: vi.fn().mockResolvedValue('raw-token'),
}))

vi.mock('@/lib/confirm-email', () => ({
  confirmIdentifier: (email: string) => `confirm:${email.toLowerCase()}`,
  consumeConfirmationToken: consumeConfirmationTokenMock,
  issueConfirmationToken: issueConfirmationTokenMock,
}))

// markEmailVerified lives in the users query module, not beside the tokens.
// auth-config calls it and is imported by middleware, which runs on the Edge
// Runtime where the token module's node:crypto import is unavailable.
vi.mock('@/db/queries/users', () => ({
  markEmailVerified: markEmailVerifiedMock,
}))

const { sendConfirmationEmailMock } = vi.hoisted(() => ({
  sendConfirmationEmailMock: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/email', () => ({
  sendConfirmationEmail: sendConfirmationEmailMock,
}))

vi.mock('@/lib/app-url', () => ({
  getAppUrl: () => 'https://app.floraclin.com.br',
}))

vi.mock('@/lib/api-error', () => ({
  handleApiError: vi.fn(
    async (_error: unknown, _request: unknown, options?: { body?: unknown }) =>
      new Response(JSON.stringify(options?.body ?? { error: 'Internal Server Error' }), { status: 500 })
  ),
}))

// ─── auth-config: capture the config object NextAuth() is built with ──

const { capturedConfig } = vi.hoisted(() => ({ capturedConfig: { current: null as any } }))

vi.mock('next-auth', () => ({
  default: vi.fn((config: any) => {
    capturedConfig.current = config
    return { auth: vi.fn(), handlers: {}, signIn: vi.fn(), signOut: vi.fn() }
  }),
}))
vi.mock('next-auth/providers/credentials', () => ({ default: vi.fn(() => ({ id: 'credentials' })) }))
vi.mock('next-auth/providers/google', () => ({ default: vi.fn(() => ({ id: 'google' })) }))
vi.mock('next-auth/providers/resend', () => ({ default: vi.fn(() => ({ id: 'resend' })) }))
vi.mock('@auth/drizzle-adapter', () => ({ DrizzleAdapter: vi.fn(() => ({})) }))
vi.mock('bcryptjs', () => ({ default: { compare: vi.fn(), hash: vi.fn() } }))

import { GET, POST } from '../route'
import { POST as POST_RESEND } from '../resend/route'
import '@/lib/auth-config' // side effect: NextAuth(config) runs, capturing config

beforeEach(() => {
  vi.clearAllMocks()
  selectQueue.length = 0
  updateQueue.length = 0
  issueConfirmationTokenMock.mockResolvedValue('raw-token')
})

// ─── GET /api/auth/confirm ──────────────────────────────────────────

describe('GET /api/auth/confirm', () => {
  it('redirects to /confirm-email carrying email and token, without consuming', async () => {
    const request = new NextRequest('https://app.floraclin.com.br/api/auth/confirm?email=a%40b.com&token=raw123')

    const response = await GET(request)

    expect(response.status).toBe(307)
    const location = new URL(response.headers.get('location')!)
    expect(location.pathname).toBe('/confirm-email')
    expect(location.searchParams.get('email')).toBe('a@b.com')
    expect(location.searchParams.get('token')).toBe('raw123')
    expect(consumeConfirmationTokenMock).not.toHaveBeenCalled()
  })
})

// ─── POST /api/auth/confirm ─────────────────────────────────────────

describe('POST /api/auth/confirm', () => {
  function postConfirm(body: unknown) {
    return POST(
      new NextRequest('https://app.floraclin.com.br/api/auth/confirm', {
        method: 'POST',
        body: JSON.stringify(body),
      })
    )
  }

  it('verifies with a valid token', async () => {
    consumeConfirmationTokenMock.mockResolvedValueOnce('a@b.com')

    const response = await postConfirm({ email: 'a@b.com', token: 'raw' })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data).toEqual({ success: true })
    expect(consumeConfirmationTokenMock).toHaveBeenCalledWith('a@b.com', 'raw')
    expect(markEmailVerifiedMock).toHaveBeenCalledWith('a@b.com')
  })

  it('fails for an expired token, and does not mark verified', async () => {
    consumeConfirmationTokenMock.mockResolvedValueOnce(null)

    const response = await postConfirm({ email: 'a@b.com', token: 'expired' })
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBeTruthy()
    expect(markEmailVerifiedMock).not.toHaveBeenCalled()
  })

  it('rejects a replayed token on the second attempt', async () => {
    consumeConfirmationTokenMock.mockResolvedValueOnce('a@b.com').mockResolvedValueOnce(null)

    const first = await postConfirm({ email: 'a@b.com', token: 'raw' })
    const second = await postConfirm({ email: 'a@b.com', token: 'raw' })

    expect(first.status).toBe(200)
    expect(second.status).toBe(400)
    expect(markEmailVerifiedMock).toHaveBeenCalledTimes(1)
  })
})

// ─── POST /api/auth/confirm/resend ──────────────────────────────────

describe('POST /api/auth/confirm/resend', () => {
  function postResend(body: unknown) {
    return POST_RESEND(
      new NextRequest('https://app.floraclin.com.br/api/auth/confirm/resend', {
        method: 'POST',
        body: JSON.stringify(body),
      })
    )
  }

  it('returns 429 when the cooldown has not elapsed', async () => {
    pushSelect([{ id: 'user-1', emailVerified: null }]) // user lookup: exists, unverified
    pushUpdate([]) // conditional UPDATE: cooldown gate not met, 0 rows
    pushSelect([{ identifier: 'confirm:a@b.com' }]) // existence check: a row does exist

    const response = await postResend({ email: 'a@b.com' })
    const data = await response.json()

    expect(response.status).toBe(429)
    expect(data.error).toBeTruthy()
    expect(issueConfirmationTokenMock).not.toHaveBeenCalled()
    expect(sendConfirmationEmailMock).not.toHaveBeenCalled()
  })

  it('sends nothing and responds the same for an unknown address', async () => {
    pushSelect([]) // user lookup: no user

    const response = await postResend({ email: 'nobody@b.com' })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data).toEqual({ success: true })
    expect(issueConfirmationTokenMock).not.toHaveBeenCalled()
    expect(sendConfirmationEmailMock).not.toHaveBeenCalled()
  })

  it('sends nothing and responds the same for an already-verified address', async () => {
    pushSelect([{ id: 'user-1', emailVerified: new Date() }])

    const response = await postResend({ email: 'a@b.com' })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data).toEqual({ success: true })
    expect(issueConfirmationTokenMock).not.toHaveBeenCalled()
    expect(sendConfirmationEmailMock).not.toHaveBeenCalled()
  })

  it('issues a fresh token and sends the email when not throttled', async () => {
    pushSelect([{ id: 'user-1', emailVerified: null }]) // user lookup
    pushUpdate([{ identifier: 'confirm:a@b.com' }]) // conditional UPDATE: claimed
    pushSelect([{ tenantName: 'Clinica Teste' }]) // membership lookup for the email copy

    const response = await postResend({ email: 'a@b.com' })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data).toEqual({ success: true })
    expect(issueConfirmationTokenMock).toHaveBeenCalledWith('a@b.com')
    expect(sendConfirmationEmailMock).toHaveBeenCalledWith(
      'a@b.com',
      expect.stringContaining('/api/auth/confirm?email=a%40b.com&token=raw-token'),
      'Clinica Teste'
    )
  })
})

// ─── auth-config: Google sign-in stamps emailVerified ───────────────

describe('Google sign-in stamps emailVerified (auth-config jwt callback)', () => {
  function jwtCallback() {
    return capturedConfig.current.callbacks.jwt
  }

  it('does not stamp for a non-Google account', async () => {
    pushSelect([]) // no membership
    pushSelect([{ isPlatformAdmin: false, emailVerified: null }]) // userRow

    await jwtCallback()({
      token: {},
      user: { id: 'u1', email: 'a@b.com' },
      account: { provider: 'credentials' },
    })

    expect(markEmailVerifiedMock).not.toHaveBeenCalled()
  })

  it('stamps emailVerified for a brand-new Google user (no tenant yet)', async () => {
    pushSelect([]) // no membership: first Google sign-in, no clinic created yet
    pushSelect([{ isPlatformAdmin: false, emailVerified: new Date() }]) // userRow, now verified

    const token = await jwtCallback()({
      token: {},
      user: { id: 'u1', email: 'new@floraclin.com.br' },
      account: { provider: 'google' },
    })

    expect(markEmailVerifiedMock).toHaveBeenCalledWith('new@floraclin.com.br')
    expect(token.emailVerified).toBe(true)
    expect(token.v).toBe(3)
  })

  it('stamps emailVerified when Google links into an existing unconfirmed credentials account', async () => {
    pushSelect([
      {
        tenantId: 'tenant-1',
        role: 'owner',
        tenantStatus: 'active',
        isPlatformAdmin: false,
        emailVerified: new Date(),
      },
    ]) // membership: the account already has a clinic from the earlier credentials signup
    pushSelect([{ status: 'trialing', planSlug: 'free', planFeatures: {} }]) // subscription

    const token = await jwtCallback()({
      token: {},
      user: { id: 'u1', email: 'existing@floraclin.com.br' },
      account: { provider: 'google' },
    })

    expect(markEmailVerifiedMock).toHaveBeenCalledWith('existing@floraclin.com.br')
    expect(token.emailVerified).toBe(true)
    expect(token.tenantStatus).toBe('active')
  })

  it('sets emailVerified on the no-membership branch even when false, never leaving it undefined', async () => {
    pushSelect([]) // no membership
    pushSelect([{ isPlatformAdmin: false, emailVerified: null }]) // userRow, still unverified

    const token = await jwtCallback()({
      token: {},
      user: { id: 'u1', email: 'pending@b.com' },
      account: { provider: 'credentials' },
    })

    expect(token.emailVerified).toBe(false)
  })
})
