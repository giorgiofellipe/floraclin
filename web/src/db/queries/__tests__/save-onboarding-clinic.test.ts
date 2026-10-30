import { randomUUID } from 'node:crypto'
import { afterEach, expect, it, describe } from 'vitest'
import { eq, inArray } from 'drizzle-orm'
import { db } from '@/db/client'
import { tenants } from '@/db/schema'
import { saveOnboardingClinic } from '../tenants'

const RUN_INTEGRATION = Boolean(process.env.DATABASE_URL_TEST || process.env.RUN_DB_TESTS)
const describeIntegration = RUN_INTEGRATION ? describe : describe.skip

const ADDRESS = { street: 'Rua das Flores', number: '10', neighborhood: 'Centro', city: 'São Paulo', state: 'SP', zipCode: '01000-000' }
const clinic = { name: 'Clínica Bella', phone: '(11) 98888-7777', email: '' }

describeIntegration('saveOnboardingClinic (integration, requires test DB)', () => {
  const tenantIds: string[] = []

  async function insertTenant(settings: Record<string, unknown> | null) {
    const id = randomUUID()
    await db.insert(tenants).values({ id, name: 'Clínica de Ana', slug: `onboarding-clinic-${id}`, address: ADDRESS, settings })
    tenantIds.push(id)
    return id
  }
  const rowOf = async (id: string) => (await db.select().from(tenants).where(eq(tenants.id, id)))[0]

  afterEach(async () => {
    if (tenantIds.length) await db.delete(tenants).where(inArray(tenants.id, tenantIds.splice(0)))
  })

  // A save that loses the race with another tab's completion must not overwrite what that tab saved.
  it('writes nothing once onboarding is completed', async () => {
    const id = await insertTenant({ onboarding_completed: true })

    expect(await saveOnboardingClinic(id, { ...clinic, slug: `bella-${id}`, address: null })).toBe(false)

    const row = await rowOf(id)
    expect(row.name).toBe('Clínica de Ana')
    expect(row.slug).toBe(`onboarding-clinic-${id}`)
    expect(row.address).toEqual(ADDRESS)
  })

  it('saves while onboarding is open, keeping an address the request left out', async () => {
    const id = await insertTenant(null)

    expect(await saveOnboardingClinic(id, { ...clinic, slug: `bella-${id}` })).toBe(true)

    const row = await rowOf(id)
    expect(row.name).toBe('Clínica Bella')
    expect(row.slug).toBe(`bella-${id}`)
    expect(row.phone).toBe('(11) 98888-7777')
    expect(row.email).toBeNull()
    expect(row.address).toEqual(ADDRESS)
  })
})
