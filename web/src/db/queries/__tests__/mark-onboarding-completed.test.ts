import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { eq, inArray } from 'drizzle-orm'
import { db } from '@/db/client'
import { tenants } from '@/db/schema'
import { markOnboardingCompleted } from '../tenants'

const RUN_INTEGRATION = Boolean(process.env.DATABASE_URL_TEST || process.env.RUN_DB_TESTS)
const describeIntegration = RUN_INTEGRATION ? describe : describe.skip

// The only thing that makes "Cadastro concluído" go out once per clinic, so
// it runs against a real database rather than a mock.
describeIntegration('markOnboardingCompleted (integration, requires test DB)', () => {
  const tenantIds: string[] = []

  async function insertTenant(settings: Record<string, unknown> | null) {
    const id = randomUUID()
    await db.insert(tenants).values({ id, name: 'Clínica Teste', slug: `mark-onboarding-${id}`, settings })
    tenantIds.push(id)
    return id
  }
  const settingsOf = async (id: string) =>
    (await db.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, id)))[0].settings

  afterEach(async () => {
    if (tenantIds.length) await db.delete(tenants).where(inArray(tenants.id, tenantIds.splice(0)))
  })

  it('wins once: the first call returns true and later calls false', async () => {
    const id = await insertTenant({})

    expect(await markOnboardingCompleted(id)).toBe(true)
    expect(await markOnboardingCompleted(id)).toBe(false)
    expect(await markOnboardingCompleted(id)).toBe(false)
  })

  it('lets exactly one of two racing saves win', async () => {
    const id = await insertTenant({})

    const results = await Promise.all([markOnboardingCompleted(id), markOnboardingCompleted(id)])

    expect(results.filter(Boolean)).toHaveLength(1)
  })

  it('keeps the other settings and applies the extra ones', async () => {
    const id = await insertTenant({ clinic_name_placeholder: true, timezone: 'America/Sao_Paulo' })

    expect(await markOnboardingCompleted(id, { clinic_name_placeholder: false })).toBe(true)
    expect(await settingsOf(id)).toEqual({
      clinic_name_placeholder: false,
      timezone: 'America/Sao_Paulo',
      onboarding_completed: true,
    })
  })

  it('works when settings is null or the flag is explicitly false', async () => {
    const nullId = await insertTenant(null)
    const falseId = await insertTenant({ onboarding_completed: false })

    expect(await markOnboardingCompleted(nullId)).toBe(true)
    expect(await markOnboardingCompleted(falseId)).toBe(true)
    expect(await settingsOf(nullId)).toEqual({ onboarding_completed: true })
  })
})
