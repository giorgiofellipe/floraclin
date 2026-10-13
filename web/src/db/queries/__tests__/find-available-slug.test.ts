import { afterEach, describe, expect, it } from 'vitest'
import { inArray } from 'drizzle-orm'
import { db } from '@/db/client'
import { tenants } from '@/db/schema'
import { findAvailableSlug, generateSlug } from '../admin-tenants'

// Regression: a long clinic name produced a slug over varchar(100) and onboarding failed with a 500.
describe('generateSlug', () => {
  it('caps the slug so a -N suffix still fits the column', () => {
    const slug = generateSlug(`${'a'.repeat(79)} ${'b'.repeat(200)}`)

    expect(slug).toBe('a'.repeat(79))
  })
})

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

  // Regression: onboarding moved a clinic off the -1 slug signup gave it, onto the one another clinic holds.
  it('keeps the suffixed slug the clinic itself already holds', async () => {
    await insertTenant(base)
    const ownId = await insertTenant(`${base}-1`)

    expect(await findAvailableSlug(db, base, ownId)).toBe(`${base}-1`)
  })
})
