// @vitest-environment node
/**
 * Booking link changes against an in-memory stand-in for the three tables they
 * touch (tenants, tenant_slug_history, audit_logs), behind drizzle's pg-proxy
 * driver, so the real queries run without a database: the 90-day reservation
 * of an old link, its redirect, and the rolling change limit.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { drizzle } from 'drizzle-orm/pg-proxy'

const store = vi.hoisted(() => ({
  tenants: new Map<string, { slug: string; deleted?: boolean }>(),
  history: new Map<string, { tenantId: string; retiredAt: string }>(),
  audits: [] as { tenantId: string; entityType: string; createdAt: string }[],
}))

const T = '"floraclin"."tenants"'
const H = '"floraclin"."tenant_slug_history"'

vi.mock('@/db/client', () => {
  const db = drizzle(async (sql: string, params: unknown[]) => {
    const p = params as string[]
    if (sql.startsWith(`select "slug" from ${T}`) && sql.endsWith('for update')) {
      const t = store.tenants.get(p[0])
      return { rows: t ? [[t.slug]] : [] }
    }
    if (sql.startsWith('select count(*) from "floraclin"."audit_logs"')) {
      const since = new Date(p[3]).getTime()
      const n = store.audits.filter(
        (a) => a.tenantId === p[0] && a.entityType === p[1] && new Date(a.createdAt).getTime() > since,
      ).length
      return { rows: [[n]] }
    }
    if (sql.startsWith('SELECT pg_advisory_xact_lock')) return { rows: [] }
    if (sql.startsWith(`select "id" from ${T}`)) {
      const holder = [...store.tenants].find(([id, t]) => t.slug === p[0] && id !== p[1])
      return { rows: holder ? [[holder[0]]] : [] }
    }
    if (sql.startsWith(`select "tenant_id", "retired_at" from ${H}`)) {
      const h = store.history.get(p[0])
      return { rows: h ? [[h.tenantId, h.retiredAt]] : [] }
    }
    if (sql.startsWith(`select ${H}."retired_at", ${T}."slug" from ${H} inner join`)) {
      const h = store.history.get(p[0])
      const t = h && store.tenants.get(h.tenantId)
      // Deleted clinics drop out only when the query asks for it.
      const hidden = t?.deleted && sql.includes(`${T}."deleted_at" is null`)
      return { rows: h && t && !hidden ? [[h.retiredAt, t.slug]] : [] }
    }
    if (sql.startsWith(`delete from ${H}`)) {
      store.history.delete(p[0])
      return { rows: [] }
    }
    if (sql.startsWith(`insert into ${H}`)) {
      store.history.set(p[0], { tenantId: p[1], retiredAt: p[2] })
      return { rows: [] }
    }
    if (sql.startsWith(`update ${T} set "slug"`)) {
      if ([...store.tenants].some(([id, t]) => t.slug === p[0] && id !== p[2])) {
        throw new Error('Failed query', { cause: { code: '23505', constraint_name: 'tenants_slug_unique' } })
      }
      store.tenants.get(p[2])!.slug = p[0]
      return { rows: [] }
    }
    // updateTenantAdmin's write of the other fields: the id, name and slug are enough here.
    if (sql.startsWith(`update ${T} set "updated_at"`)) {
      const id = p[p.length - 1]
      const t = store.tenants.get(id)
      return { rows: t ? [[id, 'Clínica', t.slug]] : [] }
    }
    // createTenantWithOwner's owner lookup and insert, before it picks the slug.
    if (sql.startsWith('select "id" from "floraclin"."users"')) return { rows: [] }
    if (sql.startsWith('insert into "floraclin"."users"')) return { rows: [] }
    if (sql.startsWith('insert into "floraclin"."audit_logs"')) {
      store.audits.push({ tenantId: p[0], entityType: p[3], createdAt: p[6] })
      return { rows: [] }
    }
    throw new Error(`Unexpected SQL: ${sql}`)
  })
  // pg-proxy has no transactions; the fake has nothing to roll back.
  ;(db as unknown as { transaction: unknown }).transaction = (fn: (tx: unknown) => unknown) => fn(db)
  return { db }
})

import { db } from '@/db/client'
import {
  BOOKING_SLUG_CHANGES_PER_DAY,
  changeBookingSlug,
  findBookingSlugRedirect,
  isBookingSlugFree,
} from '../booking-slugs'
import { ADMIN_SLUG_TAKEN, createTenantWithOwner, findAvailableSlug, updateTenantAdmin } from '../admin-tenants'

const DAY = 24 * 60 * 60 * 1000
const T0 = new Date('2026-11-02T15:00:00Z')
const at = (days: number) => new Date(T0.getTime() + days * DAY)
const change = (tenantId: string, slug: string, now: Date) =>
  changeBookingSlug({ tenantId, userId: 'user-1', slug, now })

beforeEach(() => {
  store.tenants.clear()
  store.history.clear()
  store.audits.length = 0
  store.tenants.set('ana', { slug: 'clinica-de-ana' })
  store.tenants.set('bia', { slug: 'studio-bia' })
})

describe('changing the booking link', () => {
  // Catches a change that frees the old link at once, so patients with it land on a 404.
  it('moves the clinic to the new link and redirects the old one to it', async () => {
    expect(await change('ana', 'ana-estetica', T0)).toEqual({
      outcome: 'updated',
      slug: 'ana-estetica',
      previousSlug: 'clinica-de-ana',
    })
    expect(store.tenants.get('ana')!.slug).toBe('ana-estetica')
    expect(await findBookingSlugRedirect('clinica-de-ana', at(1))).toBe('ana-estetica')
    expect(await findBookingSlugRedirect('studio-bia', at(1))).toBeNull()
  })

  it('follows later changes: the oldest link redirects to the current one', async () => {
    await change('ana', 'ana-estetica', T0)
    await change('ana', 'ana-spa', at(2))
    expect(await findBookingSlugRedirect('clinica-de-ana', at(3))).toBe('ana-spa')
    expect(await findBookingSlugRedirect('ana-estetica', at(3))).toBe('ana-spa')
  })

  // Catches another clinic taking over a link still printed on the first clinic's cards.
  it('blocks every other clinic from the old link for 90 days', async () => {
    await change('ana', 'ana-estetica', T0)

    expect(await isBookingSlugFree(db, 'clinica-de-ana', 'bia', at(89))).toBe(false)
    expect(await change('bia', 'clinica-de-ana', at(89))).toEqual({ outcome: 'taken' })
    expect(store.tenants.get('bia')!.slug).toBe('studio-bia')
    // Signup and onboarding derive slugs through findAvailableSlug: it skips the reserved one.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(at(89))
    try {
      expect(await findAvailableSlug(db, 'clinica-de-ana', 'bia')).toBe('clinica-de-ana-1')
    } finally {
      vi.useRealTimers()
    }
  })

  it('frees the old link after 90 days, and it stops redirecting', async () => {
    await change('ana', 'ana-estetica', T0)

    expect(await findBookingSlugRedirect('clinica-de-ana', at(91))).toBeNull()
    expect(await isBookingSlugFree(db, 'clinica-de-ana', 'bia', at(91))).toBe(true)
    expect((await change('bia', 'clinica-de-ana', at(91))).outcome).toBe('updated')
    expect(store.tenants.get('bia')!.slug).toBe('clinica-de-ana')
    // The new holder's own old link is the one that redirects now.
    expect(await findBookingSlugRedirect('studio-bia', at(92))).toBe('clinica-de-ana')
  })

  it('lets the clinic go back to its own old link', async () => {
    await change('ana', 'ana-estetica', T0)
    expect((await change('ana', 'clinica-de-ana', at(1))).outcome).toBe('updated')
    expect(await findBookingSlugRedirect('clinica-de-ana', at(2))).toBeNull()
    expect(await findBookingSlugRedirect('ana-estetica', at(2))).toBe('clinica-de-ana')
  })

  it('refuses a link another clinic holds now', async () => {
    expect(await change('ana', 'studio-bia', T0)).toEqual({ outcome: 'taken' })
    expect(store.history.size).toBe(0)
  })

  // Catches a clinic cycling links to squat on many names, each reserved for 90 days.
  it(`allows ${BOOKING_SLUG_CHANGES_PER_DAY} changes in 24 hours, then refuses until the window rolls`, async () => {
    for (let i = 0; i < BOOKING_SLUG_CHANGES_PER_DAY; i++) {
      expect((await change('ana', `ana-${i}`, new Date(T0.getTime() + i * 60_000))).outcome).toBe('updated')
    }
    expect(await change('ana', 'ana-extra', at(0.5))).toEqual({ outcome: 'rate_limited' })
    expect(store.tenants.get('ana')!.slug).toBe(`ana-${BOOKING_SLUG_CHANGES_PER_DAY - 1}`)

    expect((await change('ana', 'ana-extra', at(1.01))).outcome).toBe('updated')
  })

  it('counts only this clinic\'s changes', async () => {
    for (let i = 0; i < BOOKING_SLUG_CHANGES_PER_DAY; i++) await change('bia', `bia-${i}`, T0)
    expect((await change('ana', 'ana-estetica', T0)).outcome).toBe('updated')
  })

  it('answers unchanged, and writes nothing, for the current link', async () => {
    expect(await change('ana', 'clinica-de-ana', T0)).toEqual({ outcome: 'unchanged', slug: 'clinica-de-ana' })
    expect(store.history.size).toBe(0)
    expect(store.audits).toHaveLength(0)
  })

  it('does not redirect a deleted clinic\'s old link', async () => {
    await change('ana', 'ana-estetica', T0)
    store.tenants.get('ana')!.deleted = true
    expect(await findBookingSlugRedirect('clinica-de-ana', at(1))).toBeNull()
  })
})

describe('a platform admin changing the booking link', () => {
  const adminChange = (tenantId: string, slug: string, now: Date) => {
    vi.setSystemTime(now)
    return updateTenantAdmin(tenantId, { slug }, 'admin-1')
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  // Catches an admin rename leaving the clinic's shared links on a 404.
  it('redirects the old link to the new one and reserves it, like the owner\'s change', async () => {
    expect(await adminChange('ana', 'ana-estetica', T0)).toMatchObject({ id: 'ana', slug: 'ana-estetica' })

    expect(await findBookingSlugRedirect('clinica-de-ana', at(1))).toBe('ana-estetica')
    expect(await isBookingSlugFree(db, 'clinica-de-ana', 'bia', at(1))).toBe(false)
  })

  it('is not held to the owner\'s daily limit', async () => {
    for (let i = 0; i < BOOKING_SLUG_CHANGES_PER_DAY; i++) await change('ana', `ana-${i}`, T0)

    expect(await adminChange('ana', 'ana-admin', at(0.1))).toMatchObject({ slug: 'ana-admin' })
  })

  // Catches an admin handing one clinic a link another clinic's patients still use.
  it('refuses a link another clinic moved off less than 90 days ago', async () => {
    await change('bia', 'bia-nova', T0)

    await expect(adminChange('ana', 'studio-bia', at(1))).rejects.toMatchObject({ code: ADMIN_SLUG_TAKEN })
    expect(store.tenants.get('ana')!.slug).toBe('clinica-de-ana')
  })

  it('refuses the same link when creating a clinic', async () => {
    await change('bia', 'bia-nova', T0)
    vi.setSystemTime(at(1))

    await expect(
      createTenantWithOwner({ name: 'Studio', slug: 'studio-bia', ownerEmail: 'a@b.com', ownerName: 'Ana' }),
    ).rejects.toMatchObject({ code: ADMIN_SLUG_TAKEN })
  })
})
