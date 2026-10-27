import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@sentry/nextjs', () => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
  withMonitor: (_slug: string, body: () => Promise<unknown>) => body(),
  flush: vi.fn().mockResolvedValue(true),
}))

vi.mock('@/lib/email', () => ({
  sendConfirmationReminderEmail: vi.fn(),
  sendFinishSetupReminderEmail: vi.fn(),
}))

import { eq, inArray, sql } from 'drizzle-orm'
import { db } from '@/db/client'
import { tenantLifecycleMessages, tenants, tenantUsers, users, verificationTokens } from '@/db/schema'
import { confirmEmailUrl, confirmIdentifier, hashToken, issueConfirmationToken } from '@/lib/confirm-email'
import { sendConfirmationReminderEmail, sendFinishSetupReminderEmail } from '@/lib/email'
import { GET } from '@/app/api/cron/signup-reminders/route'
import {
  claimSignupReminder,
  findConfirmReminderRecipients,
  findFinishReminderRecipients,
  SIGNUP_CONFIRM_REMINDER_KEY,
  SIGNUP_FINISH_REMINDER_KEY,
} from '../signup-reminders'

// The cron reads every clinic in the DB, so all fixtures live in this one
// file: vitest runs its describes in order, never alongside each other.
const RUN_INTEGRATION = Boolean(process.env.DATABASE_URL_TEST || process.env.RUN_DB_TESTS)
const describeIntegration = RUN_INTEGRATION ? describe : describe.skip

type ReminderStatus = 'pending' | 'sent' | 'failed'

interface Fixture {
  id: string
  createdAgo: string
  passwordHash?: string | null
  emailVerified?: boolean
  lifecycleNotice?: boolean
  onboardingCompleted?: boolean
  deleted?: boolean
  reminders?: { key: string; status: ReminderStatus }[]
}

const email = (f: Fixture) => `${f.id}@signup-reminders.test`
const id = (n: number) => `00000000-0000-0000-0000-00000051${String(n).padStart(4, '0')}`

async function insertFixtures(fixtures: Fixture[]) {
  for (const f of fixtures) {
    const passwordHash = f.passwordHash === undefined ? 'hash' : f.passwordHash
    // Email sign-ups get lifecycle_notice_at at creation (insertSelfSignupTenantBase).
    const lifecycleNotice = f.lifecycleNotice ?? passwordHash !== null
    await db.insert(tenants).values({
      id: f.id,
      name: `Clínica ${f.id.slice(-4)}`,
      slug: `signup-reminders-${f.id}`,
      settings: f.onboardingCompleted ? { onboarding_completed: true } : {},
      lifecycleNoticeAt: lifecycleNotice ? sql`now()` : null,
      deletedAt: f.deleted ? sql`now()` : null,
      createdAt: sql`now() - ${f.createdAgo}::interval`,
    })
    await db.insert(users).values({
      id: f.id,
      email: email(f),
      fullName: 'Ana Souza',
      passwordHash,
      emailVerified: f.emailVerified ? sql`now()` : null,
    })
    await db.insert(tenantUsers).values({ tenantId: f.id, userId: f.id, role: 'owner' })
    for (const r of f.reminders ?? []) {
      await db.insert(tenantLifecycleMessages).values({
        tenantId: f.id,
        messageKey: r.key,
        channel: 'email',
        status: r.status,
        recipient: email(f),
      })
    }
  }
}

async function deleteFixtures(fixtures: Fixture[]) {
  const ids = fixtures.map((f) => f.id)
  await db.delete(tenantLifecycleMessages).where(inArray(tenantLifecycleMessages.tenantId, ids))
  await db.delete(tenantUsers).where(inArray(tenantUsers.tenantId, ids))
  await db.delete(users).where(inArray(users.id, ids))
  await db.delete(tenants).where(inArray(tenants.id, ids))
  await db
    .delete(verificationTokens)
    .where(inArray(verificationTokens.identifier, fixtures.map((f) => confirmIdentifier(email(f)))))
}

type Case = Fixture & { name: string; expected: 'confirm' | 'finish' | 'none' }

const GOOGLE = { passwordHash: null, emailVerified: true } as const

const CASES: Case[] = [
  { name: 'unconfirmed email signup 2h old', id: id(1), createdAgo: '2 hours', expected: 'confirm' },
  { name: 'unconfirmed signup under 1h old', id: id(2), createdAgo: '30 minutes', expected: 'none' },
  { name: 'unconfirmed signup over 7 days old', id: id(3), createdAgo: '8 days', expected: 'none' },
  {
    name: 'unconfirmed signup already reminded',
    id: id(4),
    createdAgo: '2 hours',
    reminders: [{ key: SIGNUP_CONFIRM_REMINDER_KEY, status: 'sent' }],
    expected: 'none',
  },
  {
    name: 'unconfirmed signup whose reminder failed',
    id: id(12),
    createdAgo: '2 hours',
    reminders: [{ key: SIGNUP_CONFIRM_REMINDER_KEY, status: 'failed' }],
    expected: 'confirm',
  },
  {
    name: 'unconfirmed signup with a reminder in flight',
    id: id(13),
    createdAgo: '2 hours',
    reminders: [{ key: SIGNUP_CONFIRM_REMINDER_KEY, status: 'pending' }],
    expected: 'none',
  },
  { name: 'unconfirmed signup on a deleted clinic', id: id(5), createdAgo: '2 hours', deleted: true, expected: 'none' },
  {
    name: 'confirmed email signup the lifecycle already reaches',
    id: id(6),
    createdAgo: '2 hours',
    emailVerified: true,
    expected: 'none',
  },
  { name: 'Google signup created on arrival, onboarding pending', id: id(7), createdAgo: '2 hours', ...GOOGLE, expected: 'finish' },
  {
    name: 'created-on-arrival clinic that finished onboarding',
    id: id(8),
    createdAgo: '2 hours',
    ...GOOGLE,
    onboardingCompleted: true,
    expected: 'none',
  },
  {
    name: 'created-on-arrival clinic already reminded to finish',
    id: id(9),
    createdAgo: '2 hours',
    ...GOOGLE,
    reminders: [{ key: SIGNUP_FINISH_REMINDER_KEY, status: 'sent' }],
    expected: 'none',
  },
  {
    name: 'created-on-arrival clinic with a confirm reminder only',
    id: id(10),
    createdAgo: '2 hours',
    ...GOOGLE,
    reminders: [{ key: SIGNUP_CONFIRM_REMINDER_KEY, status: 'sent' }],
    expected: 'finish',
  },
  { name: 'unconfirmed account with no password', id: id(11), createdAgo: '2 hours', passwordHash: null, expected: 'none' },
]

describeIntegration('signup reminders (integration, requires test DB)', () => {
  describe('selection', () => {
    let confirmIds: Set<string>
    let finishIds: Set<string>

    beforeAll(async () => {
      await deleteFixtures(CASES)
      await insertFixtures(CASES)
      confirmIds = new Set((await findConfirmReminderRecipients()).map((r) => r.tenantId))
      finishIds = new Set((await findFinishReminderRecipients()).map((r) => r.tenantId))
    })

    afterAll(async () => {
      await deleteFixtures(CASES)
    })

    it.each(CASES)('$name: $expected', ({ id, expected }) => {
      expect({ confirm: confirmIds.has(id), finish: finishIds.has(id) }).toEqual({
        confirm: expected === 'confirm',
        finish: expected === 'finish',
      })
    })
  })

  describe('claimSignupReminder', () => {
    const TENANT: Fixture = { id: id(20), createdAgo: '2 hours' }
    const claim = () =>
      claimSignupReminder({ tenantId: TENANT.id, messageKey: SIGNUP_CONFIRM_REMINDER_KEY, recipient: email(TENANT) })
    const setStatus = (status: ReminderStatus) =>
      db.update(tenantLifecycleMessages).set({ status }).where(eq(tenantLifecycleMessages.tenantId, TENANT.id))

    beforeAll(async () => {
      await deleteFixtures([TENANT])
      await insertFixtures([TENANT])
    })

    beforeEach(async () => {
      await db.delete(tenantLifecycleMessages).where(eq(tenantLifecycleMessages.tenantId, TENANT.id))
    })

    afterAll(async () => {
      await deleteFixtures([TENANT])
    })

    // Catches a claim that cannot take over a failed row, so a failed reminder is never retried.
    it('takes over a failed row, and never a sent or pending one', async () => {
      const first = await claim()
      await setStatus('failed')
      expect(await claim()).toBe(first)
      await setStatus('sent')
      expect(await claim()).toBeNull()
      await setStatus('pending')
      expect(await claim()).toBeNull()
    })

    // Catches a read-then-write retry, which lets two overlapping runs both send.
    it('lets one of two concurrent claims win, on a new and on a failed row', async () => {
      const fresh = await Promise.all([claim(), claim()])
      expect(fresh.filter(Boolean)).toHaveLength(1)
      await setStatus('failed')
      const retried = await Promise.all([claim(), claim()])
      expect(retried.filter(Boolean)).toHaveLength(1)
    })
  })

  describe('GET /api/cron/signup-reminders', () => {
    const SECRET = 'test-secret'
    const UNCONFIRMED: Fixture = { id: id(30), createdAgo: '2 hours' }
    const FAILING: Fixture = { id: id(31), createdAgo: '3 hours' }
    const ON_ARRIVAL: Fixture = { id: id(32), createdAgo: '2 hours', ...GOOGLE }
    const FIXTURES = [UNCONFIRMED, FAILING, ON_ARRIVAL]
    const OUR_EMAILS = new Set(FIXTURES.map(email))
    let resendDown = true

    const runCron = () =>
      GET(new Request('http://localhost/api/cron/signup-reminders', { headers: { authorization: `Bearer ${SECRET}` } }))

    const sentTo = (mock: typeof sendConfirmationReminderEmail | typeof sendFinishSetupReminderEmail) =>
      vi.mocked(mock).mock.calls.map(([to]) => to).filter((to) => OUR_EMAILS.has(to)).sort()

    const clearSends = () => {
      vi.mocked(sendConfirmationReminderEmail).mockClear()
      vi.mocked(sendFinishSetupReminderEmail).mockClear()
    }

    beforeAll(async () => {
      vi.stubEnv('CRON_SECRET', SECRET)
      vi.stubEnv('NEXTAUTH_SECRET', 'test-nextauth-secret')
      vi.spyOn(console, 'log').mockImplementation(() => {})
      vi.mocked(sendConfirmationReminderEmail).mockImplementation(async (to) => {
        if (resendDown && to === email(FAILING)) throw new Error('Resend is down')
        return { id: `resend-${to}` }
      })
      vi.mocked(sendFinishSetupReminderEmail).mockResolvedValue({ id: 'resend-finish' })
      await deleteFixtures(FIXTURES)
      await insertFixtures(FIXTURES)
    })

    afterAll(async () => {
      await deleteFixtures(FIXTURES)
      vi.unstubAllEnvs()
    })

    // Catches sending without the claim row (every clinic emailed each hour) and
    // a failed send that is never retried.
    it('sends each reminder once, retries a failed send on the next run, and then stops', async () => {
      clearSends()
      expect((await runCron()).status).toBe(200)
      expect(sentTo(sendConfirmationReminderEmail)).toEqual([email(UNCONFIRMED), email(FAILING)].sort())
      expect(sentTo(sendFinishSetupReminderEmail)).toEqual([email(ON_ARRIVAL)])

      resendDown = false
      clearSends()
      await runCron()
      expect(sentTo(sendConfirmationReminderEmail)).toEqual([email(FAILING)])
      expect(sentTo(sendFinishSetupReminderEmail)).toEqual([])

      clearSends()
      await runCron()
      expect(sentTo(sendConfirmationReminderEmail)).toEqual([])
      expect(sentTo(sendFinishSetupReminderEmail)).toEqual([])

      const rows = await db
        .select({ tenantId: tenantLifecycleMessages.tenantId, status: tenantLifecycleMessages.status })
        .from(tenantLifecycleMessages)
        .where(inArray(tenantLifecycleMessages.tenantId, FIXTURES.map((f) => f.id)))
      expect(rows.map((r) => r.status)).toEqual(['sent', 'sent', 'sent'])
    })

    const remindAgain = async () => {
      await db.delete(tenantLifecycleMessages).where(eq(tenantLifecycleMessages.tenantId, UNCONFIRMED.id))
      clearSends()
      await runCron()
      return vi.mocked(sendConfirmationReminderEmail).mock.calls.find(([to]) => to === email(UNCONFIRMED))![1]
    }

    // Catches the reminder rotating the token, which kills the link in the signup email.
    it('resends the signup link while it is still valid', async () => {
      const signupUrl = confirmEmailUrl(email(UNCONFIRMED), (await issueConfirmationToken(email(UNCONFIRMED)))!)

      expect(await remindAgain()).toBe(signupUrl)
    })

    // Catches resending an expired signup link, which the confirm route refuses.
    it('issues a working link once the signup link has expired', async () => {
      const identifier = confirmIdentifier(email(UNCONFIRMED))
      await db
        .update(verificationTokens)
        .set({ expires: sql`now() - interval '1 minute'` })
        .where(eq(verificationTokens.identifier, identifier))

      const token = new URL(await remindAgain()).searchParams.get('token')!
      const [stored] = await db
        .select({ token: verificationTokens.token, expires: verificationTokens.expires })
        .from(verificationTokens)
        .where(eq(verificationTokens.identifier, identifier))
      expect(stored.token).toBe(hashToken(token))
      expect(stored.expires.getTime()).toBeGreaterThan(Date.now())
    })
  })
})
