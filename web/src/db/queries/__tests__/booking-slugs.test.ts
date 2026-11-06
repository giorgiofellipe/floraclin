// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq, inArray, sql } from 'drizzle-orm'
import { db } from '@/db/client'
import { auditLogs, tenantSlugHistory, tenants, tenantUsers, users } from '@/db/schema'
import { changeBookingSlug, findBookingSlugRedirect, isBookingSlugFree } from '../booking-slugs'
import { BOOKING_SLUG_CHANGES_PER_DAY } from '@/lib/booking-slug'
import { ADMIN_SLUG_TAKEN, createTenantWithOwner, findAvailableSlug, updateTenantAdmin } from '../admin-tenants'

const RUN_INTEGRATION = Boolean(process.env.DATABASE_URL_TEST || process.env.RUN_DB_TESTS)
const describeIntegration = RUN_INTEGRATION ? describe : describe.skip

const DAY = 24 * 60 * 60 * 1000
const T0 = new Date('2026-11-02T15:00:00Z')
const at = (days: number) => new Date(T0.getTime() + days * DAY)

describeIntegration('booking links (integration, requires test DB)', () => {
  // tenant_slug_history is keyed by slug alone, so every run needs its own names.
  let run: string
  const s = (name: string) => `${name}-${run}`
  const tenantIds: string[] = []
  const userIds: string[] = []
  let userId: string
  let ana: string
  let bia: string

  async function insertTenant(slug: string) {
    const [row] = await db.insert(tenants).values({ name: slug, slug }).returning({ id: tenants.id })
    tenantIds.push(row.id)
    return row.id
  }
  const slugOf = async (tenantId: string) =>
    (await db.select({ slug: tenants.slug }).from(tenants).where(eq(tenants.id, tenantId)))[0].slug
  const change = (tenantId: string, slug: string, now: Date) => changeBookingSlug({ tenantId, userId, slug, now })
  const historyOf = (tenantId: string) =>
    db.select().from(tenantSlugHistory).where(eq(tenantSlugHistory.tenantId, tenantId))

  beforeEach(async () => {
    run = randomUUID().slice(0, 8)
    userId = randomUUID()
    await db.insert(users).values({ id: userId, email: `slug-${userId}@clinica.test`, fullName: 'Ana' })
    userIds.push(userId)
    ana = await insertTenant(s('clinica-de-ana'))
    bia = await insertTenant(s('studio-bia'))
  })

  afterEach(async () => {
    vi.useRealTimers()
    const ownerIds = (
      await db.select({ id: tenantUsers.userId }).from(tenantUsers).where(inArray(tenantUsers.tenantId, tenantIds))
    ).map((r) => r.id)
    const doneTenants = tenantIds.splice(0)
    const doneUsers = [...userIds.splice(0), ...ownerIds]
    await db.delete(auditLogs).where(inArray(auditLogs.tenantId, doneTenants))
    await db.delete(tenantSlugHistory).where(inArray(tenantSlugHistory.tenantId, doneTenants))
    await db.delete(tenantUsers).where(inArray(tenantUsers.tenantId, doneTenants))
    await db.delete(tenants).where(inArray(tenants.id, doneTenants))
    if (doneUsers.length) await db.delete(users).where(inArray(users.id, doneUsers))
  })

  describe('changing the booking link', () => {
    // Catches a change that frees the old link at once, so patients with it land on a 404.
    it('moves the clinic to the new link and redirects the old one to it', async () => {
      expect(await change(ana, s('ana-estetica'), T0)).toEqual({
        outcome: 'updated',
        slug: s('ana-estetica'),
        previousSlug: s('clinica-de-ana'),
      })
      expect(await slugOf(ana)).toBe(s('ana-estetica'))
      expect(await findBookingSlugRedirect(s('clinica-de-ana'), at(1))).toBe(s('ana-estetica'))
      expect(await findBookingSlugRedirect(s('studio-bia'), at(1))).toBeNull()
    })

    it('follows later changes: the oldest link redirects to the current one', async () => {
      await change(ana, s('ana-estetica'), T0)
      await change(ana, s('ana-spa'), at(2))
      expect(await findBookingSlugRedirect(s('clinica-de-ana'), at(3))).toBe(s('ana-spa'))
      expect(await findBookingSlugRedirect(s('ana-estetica'), at(3))).toBe(s('ana-spa'))
    })

    // Catches another clinic taking over a link still printed on the first clinic's cards.
    it('blocks every other clinic from the old link for 90 days', async () => {
      await change(ana, s('ana-estetica'), T0)

      expect(await isBookingSlugFree(db, s('clinica-de-ana'), bia, at(89))).toBe(false)
      expect(await change(bia, s('clinica-de-ana'), at(89))).toEqual({ outcome: 'taken' })
      expect(await slugOf(bia)).toBe(s('studio-bia'))
      // Signup and onboarding derive slugs through findAvailableSlug: it skips the reserved one.
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(at(89))
      expect(await findAvailableSlug(db, s('clinica-de-ana'), bia)).toBe(`${s('clinica-de-ana')}-1`)
    })

    it('frees the old link after 90 days, and it stops redirecting', async () => {
      await change(ana, s('ana-estetica'), T0)

      expect(await findBookingSlugRedirect(s('clinica-de-ana'), at(91))).toBeNull()
      expect(await isBookingSlugFree(db, s('clinica-de-ana'), bia, at(91))).toBe(true)
      expect((await change(bia, s('clinica-de-ana'), at(91))).outcome).toBe('updated')
      expect(await slugOf(bia)).toBe(s('clinica-de-ana'))
      // The new holder's own old link is the one that redirects now.
      expect(await findBookingSlugRedirect(s('studio-bia'), at(92))).toBe(s('clinica-de-ana'))
    })

    it('lets the clinic go back to its own old link', async () => {
      await change(ana, s('ana-estetica'), T0)
      expect((await change(ana, s('clinica-de-ana'), at(1))).outcome).toBe('updated')
      expect(await findBookingSlugRedirect(s('clinica-de-ana'), at(2))).toBeNull()
      expect(await findBookingSlugRedirect(s('ana-estetica'), at(2))).toBe(s('clinica-de-ana'))
    })

    it('refuses a link another clinic holds now', async () => {
      expect(await change(ana, s('studio-bia'), T0)).toEqual({ outcome: 'taken' })
      expect(await historyOf(ana)).toEqual([])
    })

    // Catches a clinic cycling links to squat on many names, each reserved for 90 days.
    it(`allows ${BOOKING_SLUG_CHANGES_PER_DAY} changes in 24 hours, then refuses until the window rolls`, async () => {
      for (let i = 0; i < BOOKING_SLUG_CHANGES_PER_DAY; i++) {
        expect((await change(ana, s(`ana-${i}`), new Date(T0.getTime() + i * 60_000))).outcome).toBe('updated')
      }
      expect(await change(ana, s('ana-extra'), at(0.5))).toEqual({ outcome: 'rate_limited' })
      expect(await slugOf(ana)).toBe(s(`ana-${BOOKING_SLUG_CHANGES_PER_DAY - 1}`))

      expect((await change(ana, s('ana-extra'), at(1.01))).outcome).toBe('updated')
    })

    it('counts only this clinic\'s changes', async () => {
      for (let i = 0; i < BOOKING_SLUG_CHANGES_PER_DAY; i++) await change(bia, s(`bia-${i}`), T0)
      expect((await change(ana, s('ana-estetica'), T0)).outcome).toBe('updated')
    })

    it('answers unchanged, and writes nothing, for the current link', async () => {
      expect(await change(ana, s('clinica-de-ana'), T0)).toEqual({ outcome: 'unchanged', slug: s('clinica-de-ana') })
      expect(await historyOf(ana)).toEqual([])
      expect(await db.select().from(auditLogs).where(eq(auditLogs.tenantId, ana))).toEqual([])
    })

    it('does not redirect a deleted clinic\'s old link', async () => {
      await change(ana, s('ana-estetica'), T0)
      await db.update(tenants).set({ deletedAt: new Date() }).where(eq(tenants.id, ana))
      expect(await findBookingSlugRedirect(s('clinica-de-ana'), at(1))).toBeNull()
    })

    // Catches the unique-violation fallback aborting a caller's transaction: the
    // violation has to stay inside the savepoint changeBookingSlug opens.
    it('answers taken when another clinic commits the link mid-change, and leaves the outer transaction usable', async () => {
      let commitRival!: () => void
      const rivalHolds = new Promise<void>((resolve) => {
        commitRival = resolve
      })
      const rivalInserted = Promise.withResolvers<void>()
      const rivalId = randomUUID()
      tenantIds.push(rivalId)
      const rival = db.transaction(async (tx) => {
        await tx.insert(tenants).values({ id: rivalId, name: 'Rival', slug: s('disputado') })
        rivalInserted.resolve()
        await rivalHolds
      })
      await rivalInserted.promise

      const outer = db.transaction(async (tx) => {
        const result = await changeBookingSlug({ tenantId: ana, userId, slug: s('disputado'), now: T0 }, tx)
        await tx.update(tenants).set({ name: 'Ana Estética' }).where(eq(tenants.id, ana))
        return result
      })
      // The change passed its checks (the rival row is uncommitted) and waits on the unique index.
      await expect
        .poll(async () => {
          const [row] = await db.execute<{ n: number }>(
            sql`select count(*)::int as n from pg_stat_activity where wait_event_type = 'Lock' and query like 'update "floraclin"."tenants" set "slug"%'`,
          )
          return row.n
        })
        .toBe(1)
      commitRival()
      await rival

      expect(await outer).toEqual({ outcome: 'taken' })
      const [row] = await db.select({ slug: tenants.slug, name: tenants.name }).from(tenants).where(eq(tenants.id, ana))
      expect(row).toEqual({ slug: s('clinica-de-ana'), name: 'Ana Estética' })
      expect(await historyOf(ana)).toEqual([])
    })
  })

  describe('a platform admin changing the booking link', () => {
    const adminChange = (tenantId: string, slug: string, now: Date) => {
      vi.setSystemTime(now)
      return updateTenantAdmin(tenantId, { slug }, userId)
    }

    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['Date'] })
    })

    // Catches an admin rename leaving the clinic's shared links on a 404.
    it('redirects the old link to the new one and reserves it, like the owner\'s change', async () => {
      expect(await adminChange(ana, s('ana-estetica'), T0)).toMatchObject({ id: ana, slug: s('ana-estetica') })

      expect(await findBookingSlugRedirect(s('clinica-de-ana'), at(1))).toBe(s('ana-estetica'))
      expect(await isBookingSlugFree(db, s('clinica-de-ana'), bia, at(1))).toBe(false)
    })

    it('is not held to the owner\'s daily limit', async () => {
      for (let i = 0; i < BOOKING_SLUG_CHANGES_PER_DAY; i++) await change(ana, s(`ana-${i}`), T0)

      expect(await adminChange(ana, s('ana-admin'), at(0.1))).toMatchObject({ slug: s('ana-admin') })
    })

    // Catches an admin's fixes using up the owner's daily changes and locking the owner out.
    it('does not count toward the owner\'s daily limit', async () => {
      for (let i = 0; i < BOOKING_SLUG_CHANGES_PER_DAY; i++) await adminChange(ana, s(`ana-admin-${i}`), T0)

      expect((await change(ana, s('ana-estetica'), at(0.1))).outcome).toBe('updated')
    })

    // Catches an admin handing one clinic a link another clinic's patients still use.
    it('refuses a link another clinic moved off less than 90 days ago', async () => {
      await change(bia, s('bia-nova'), T0)

      await expect(adminChange(ana, s('studio-bia'), at(1))).rejects.toMatchObject({ code: ADMIN_SLUG_TAKEN })
      expect(await slugOf(ana)).toBe(s('clinica-de-ana'))
    })

    it('refuses the same link when creating a clinic', async () => {
      await change(bia, s('bia-nova'), T0)
      vi.setSystemTime(at(1))

      await expect(
        createTenantWithOwner({ name: 'Studio', slug: s('studio-bia'), ownerEmail: `${s('owner')}@clinica.test`, ownerName: 'Ana' }),
      ).rejects.toMatchObject({ code: ADMIN_SLUG_TAKEN })
    })
  })
})
