import { afterEach, describe, expect, it } from 'vitest'
import { inArray } from 'drizzle-orm'
import { db } from '@/db/client'
import { tenants } from '@/db/schema'
import { findAvailableSlug } from '../admin-tenants'

const RUN_INTEGRATION = Boolean(process.env.DATABASE_URL_TEST || process.env.RUN_DB_TESTS)
const describeIntegration = RUN_INTEGRATION ? describe : describe.skip

describeIntegration('findAvailableSlug (integration, requires test DB)', () => {
  const base = `slug-test-${Date.now()}`
  const createdIds: string[] = []

  async function insertTenant(slug: string) {
    const [row] = await db.insert(tenants).values({ name: slug, slug }).returning({ id: tenants.id })
    createdIds.push(row.id)
    return row.id
  }

  afterEach(async () => {
    if (createdIds.length) await db.delete(tenants).where(inArray(tenants.id, createdIds.splice(0)))
  })

  // Regression: onboarding rebuilt the plain name slug that another clinic held and failed on the unique index.
  it('skips slugs held by other clinics', async () => {
    await insertTenant(base)
    await insertTenant(`${base}-1`)

    expect(await findAvailableSlug(db, base)).toBe(`${base}-2`)
  })

  // Regression: onboarding moved a clinic off its own slug because it counted itself as taken.
  it('keeps the slug the clinic itself already holds', async () => {
    const ownId = await insertTenant(base)

    expect(await findAvailableSlug(db, base, ownId)).toBe(base)
  })
})
