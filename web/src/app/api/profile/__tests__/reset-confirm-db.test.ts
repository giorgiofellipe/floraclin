// @vitest-environment node
import { createHash, randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { eq, inArray } from 'drizzle-orm'
import { db } from '@/db/client'
import { users, verificationTokens } from '@/db/schema'
import { POST as confirmReset } from '../reset-confirm/route'

const RUN_INTEGRATION = Boolean(process.env.DATABASE_URL_TEST || process.env.RUN_DB_TESTS)
const describeIntegration = RUN_INTEGRATION ? describe : describe.skip

// Owners can use the app before confirming; a password set through the reset
// e-mail (how invited and admin-created owners get one) must count as
// confirmed, or their WhatsApp sends stay blocked and reminders go out.
describeIntegration('POST /api/profile/reset-confirm (integration, requires test DB)', () => {
  const emails: string[] = []

  afterEach(async () => {
    const done = emails.splice(0)
    if (!done.length) return
    await db.delete(verificationTokens).where(inArray(verificationTokens.identifier, done))
    await db.delete(users).where(inArray(users.email, done))
  })

  async function resetWith(emailVerified: Date | null) {
    const id = randomUUID()
    const email = `reset-${id}@clinica.test`
    emails.push(email)
    await db.insert(users).values({ id, email, fullName: 'Dona', emailVerified })
    const token = randomUUID()
    await db.insert(verificationTokens).values({
      identifier: email,
      token: createHash('sha256').update(token).digest('hex'),
      expires: new Date(Date.now() + 60_000),
    })
    const res = await confirmReset(
      new Request('http://localhost/api/profile/reset-confirm', {
        method: 'POST',
        body: JSON.stringify({ token, email, newPassword: 'nova-senha-1' }),
      }),
    )
    expect(res.status).toBe(200)
    return (await db.select({ v: users.emailVerified }).from(users).where(eq(users.id, id)))[0].v
  }

  it('confirms an unconfirmed address', async () => {
    const before = Date.now()
    expect((await resetWith(null))?.getTime()).toBeGreaterThanOrEqual(before - 1000)
  })

  it('keeps an earlier confirmation', async () => {
    const earlier = new Date('2026-01-10T12:00:00Z')
    expect(await resetWith(earlier)).toEqual(earlier)
  })
})
