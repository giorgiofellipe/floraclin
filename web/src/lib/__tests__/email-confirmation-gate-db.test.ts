// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { inArray, sql } from 'drizzle-orm'
import { db } from '@/db/client'
import { tenants, tenantUsers, users } from '@/db/schema'
import {
  EmailConfirmationRequiredError,
  isTenantAwaitingEmailConfirmation,
  requireTenantEmailConfirmed,
} from '../email-confirmation-gate'

const RUN_INTEGRATION = Boolean(process.env.DATABASE_URL_TEST || process.env.RUN_DB_TESTS)
const describeIntegration = RUN_INTEGRATION ? describe : describe.skip

type Member = {
  role?: 'owner' | 'practitioner'
  isActive?: boolean
  passwordHash?: string | null
  verified?: boolean
  joinedAgo?: string
}

const PASSWORD_UNCONFIRMED: Member = { passwordHash: 'hash', verified: false }
const PASSWORD_CONFIRMED: Member = { passwordHash: 'hash', verified: true }

// Crons and queue drains send on the clinic's behalf with no signed-in user,
// so they judge the clinic by its first active owner, as the lifecycle and
// reminder queries pick it.
describeIntegration('isTenantAwaitingEmailConfirmation (integration, requires test DB)', () => {
  const tenantIds: string[] = []
  const userIds: string[] = []

  afterEach(async () => {
    const doneTenants = tenantIds.splice(0)
    const doneUsers = userIds.splice(0)
    if (doneTenants.length) {
      await db.delete(tenantUsers).where(inArray(tenantUsers.tenantId, doneTenants))
      await db.delete(tenants).where(inArray(tenants.id, doneTenants))
    }
    if (doneUsers.length) await db.delete(users).where(inArray(users.id, doneUsers))
  })

  async function clinicWith(members: Member[]) {
    const [tenant] = await db
      .insert(tenants)
      .values({ name: 'Clínica', slug: `gate-${randomUUID()}` })
      .returning({ id: tenants.id })
    tenantIds.push(tenant.id)
    for (const m of members) {
      const userId = randomUUID()
      userIds.push(userId)
      await db.insert(users).values({
        id: userId,
        email: `gate-${userId}@clinica.test`,
        fullName: 'Ana',
        passwordHash: m.passwordHash ?? null,
        emailVerified: m.verified ? new Date() : null,
      })
      await db.insert(tenantUsers).values({
        tenantId: tenant.id,
        userId,
        role: m.role ?? 'owner',
        isActive: m.isActive ?? true,
        createdAt: sql`now() - ${m.joinedAgo ?? '0 seconds'}::interval` as never,
      })
    }
    return tenant.id
  }

  it.each<[string, Member[], boolean]>([
    ['an owner with a password and no confirmation', [PASSWORD_UNCONFIRMED], true],
    ['a confirmed owner', [PASSWORD_CONFIRMED], false],
    ['an unconfirmed owner who never had a password (Google, magic link, invited)', [{ passwordHash: null }], false],
    ['a clinic without an owner', [], false],
    ['an unconfirmed practitioner under a confirmed owner', [PASSWORD_CONFIRMED, { ...PASSWORD_UNCONFIRMED, role: 'practitioner' }], false],
    [
      'a confirmed first owner and a later unconfirmed one',
      [{ ...PASSWORD_CONFIRMED, joinedAgo: '2 days' }, { ...PASSWORD_UNCONFIRMED, joinedAgo: '1 day' }],
      false,
    ],
    [
      'an unconfirmed first owner and a later confirmed one',
      [{ ...PASSWORD_UNCONFIRMED, joinedAgo: '2 days' }, { ...PASSWORD_CONFIRMED, joinedAgo: '1 day' }],
      true,
    ],
    [
      'an inactive unconfirmed first owner and a confirmed active one',
      [{ ...PASSWORD_UNCONFIRMED, isActive: false, joinedAgo: '2 days' }, { ...PASSWORD_CONFIRMED, joinedAgo: '1 day' }],
      false,
    ],
  ])('%s: %s', async (_name, members, awaiting) => {
    const tenantId = await clinicWith(members)

    expect(await isTenantAwaitingEmailConfirmation(tenantId)).toBe(awaiting)
    const required = requireTenantEmailConfirmed(tenantId)
    if (awaiting) await expect(required).rejects.toBeInstanceOf(EmailConfirmationRequiredError)
    else await expect(required).resolves.toBeUndefined()
  })
})
