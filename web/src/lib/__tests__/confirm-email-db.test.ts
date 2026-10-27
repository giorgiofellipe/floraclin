import { randomUUID } from 'node:crypto'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { eq, inArray, sql } from 'drizzle-orm'
import type { NextAuthConfig } from 'next-auth'
import { db } from '@/db/client'
import { users, verificationTokens } from '@/db/schema'
import { confirmIdentifier, getOrIssueConfirmationUrl, issueConfirmationToken } from '../confirm-email'

const RUN_INTEGRATION = Boolean(process.env.DATABASE_URL_TEST || process.env.RUN_DB_TESTS)
const describeIntegration = RUN_INTEGRATION ? describe : describe.skip

vi.mock('@/lib/lifecycle-sender', () => ({ scheduleLifecycleWelcome: vi.fn() }))
vi.mock('@/lib/analytics/server-events', () => ({ trackEmailConfirmed: vi.fn() }))

const { nextAuthConfig } = vi.hoisted(() => ({ nextAuthConfig: { current: null as NextAuthConfig | null } }))
vi.mock('next-auth', () => ({
  default: (config: NextAuthConfig) => {
    nextAuthConfig.current = config
    return { auth: vi.fn(), handlers: {}, signIn: vi.fn(), signOut: vi.fn() }
  },
}))
vi.mock('next-auth/providers/credentials', () => ({ default: (config: object) => ({ id: 'credentials', ...config }) }))
vi.mock('next-auth/providers/google', () => ({ default: () => ({}) }))
vi.mock('next-auth/providers/resend', () => ({ default: () => ({}) }))

async function authorizeConfirm(email: string, token: string) {
  await import('../auth-config')
  const provider = nextAuthConfig.current!.providers.find(
    (p) => (p as { id?: string }).id === 'confirm-email',
  ) as unknown as { authorize: (c: Record<string, string>) => Promise<unknown> }
  return provider.authorize({ email, token })
}

// Most confirmation links are opened in a browser that never had a session,
// so the confirm click itself has to sign in, and only for a live link.
describeIntegration('confirm-email sign-in and links (integration, requires test DB)', () => {
  const emails: string[] = []

  beforeAll(() => {
    process.env.NEXTAUTH_SECRET ??= 'test-secret'
  })

  async function insertUser() {
    const id = randomUUID()
    const email = `confirm-${id}@clinica.com.br`
    await db.insert(users).values({ id, email, fullName: 'Ana Souza' })
    emails.push(email)
    return { id, email }
  }
  const emailVerifiedOf = async (id: string) =>
    (await db.select({ v: users.emailVerified }).from(users).where(eq(users.id, id)))[0].v

  afterEach(async () => {
    const done = emails.splice(0)
    if (!done.length) return
    await db.delete(verificationTokens).where(inArray(verificationTokens.identifier, done.map(confirmIdentifier)))
    await db.delete(users).where(inArray(users.email, done))
  })

  it('a valid token verifies the address and signs in, whatever the e-mail case', async () => {
    const { id, email } = await insertUser()
    const token = (await issueConfirmationToken(email))!

    const user = await authorizeConfirm(email.toUpperCase(), token)

    expect(user).toEqual({ id, email, name: 'Ana Souza' })
    expect(await emailVerifiedOf(id)).not.toBeNull()
  })

  it.each([
    ['a wrong token', async () => {}, () => 'not-the-token'],
    [
      'an expired token',
      async (email: string) => {
        await db
          .update(verificationTokens)
          .set({ expires: sql`now() - interval '1 minute'` })
          .where(eq(verificationTokens.identifier, confirmIdentifier(email)))
      },
      (token: string) => token,
    ],
    [
      'a token sent before a password change',
      async (email: string) => {
        await db
          .update(users)
          .set({ passwordChangedAt: sql`now() + interval '1 minute'` })
          .where(eq(users.email, email))
      },
      (token: string) => token,
    ],
  ] as const)('%s does not sign in or verify', async (_name, arrange, tokenToUse) => {
    const { id, email } = await insertUser()
    const token = (await issueConfirmationToken(email))!
    await arrange(email)

    expect(await authorizeConfirm(email, tokenToUse(token))).toBeNull()
    expect(await emailVerifiedOf(id)).toBeNull()
  })

  it('a token works once', async () => {
    const { email } = await insertUser()
    const token = (await issueConfirmationToken(email))!

    expect(await authorizeConfirm(email, token)).not.toBeNull()
    expect(await authorizeConfirm(email, token)).toBeNull()
  })

  it('a reminder resends the live link, and a fresh one once it expired', async () => {
    const { email } = await insertUser()

    const first = await getOrIssueConfirmationUrl(email)
    expect(await getOrIssueConfirmationUrl(email)).toBe(first)

    await db
      .update(verificationTokens)
      .set({ expires: sql`now() - interval '1 minute'` })
      .where(eq(verificationTokens.identifier, confirmIdentifier(email)))
    const renewed = await getOrIssueConfirmationUrl(email)

    expect(renewed).not.toBe(first)
    const token = new URL(renewed).searchParams.get('token')!
    expect(await authorizeConfirm(email, token)).not.toBeNull()
  })
})
