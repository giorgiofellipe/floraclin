import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { eq, inArray } from 'drizzle-orm'
import { db } from '@/db/client'
import { tenants } from '@/db/schema'
import { saveOnboardingProgress } from '../tenants'

const RUN_INTEGRATION = Boolean(process.env.DATABASE_URL_TEST || process.env.RUN_DB_TESTS)
const describeIntegration = RUN_INTEGRATION ? describe : describe.skip

// Autosave races the final submit, so the guard and the once-only notice
// stamp run against a real database rather than a mock.
describeIntegration('saveOnboardingProgress (integration, requires test DB)', () => {
  const tenantIds: string[] = []

  async function insertTenant(values: { settings?: Record<string, unknown>; lifecycleNoticeAt?: Date } = {}) {
    const id = randomUUID()
    await db.insert(tenants).values({ id, name: 'Clínica de Ana', slug: `onboarding-progress-${id}`, ...values })
    tenantIds.push(id)
    return id
  }
  const rowOf = async (id: string) => (await db.select().from(tenants).where(eq(tenants.id, id)))[0]

  afterEach(async () => {
    if (tenantIds.length) await db.delete(tenants).where(inArray(tenants.id, tenantIds.splice(0)))
  })

  it('saves the clinic columns and merges the draft into the other settings', async () => {
    const id = await insertTenant({ settings: { clinic_name_placeholder: true, timezone: 'America/Sao_Paulo' } })
    const draft = { step: 2, customSlug: 'bella' }

    const result = await saveOnboardingProgress(id, { name: 'Clínica Bella', email: 'oi@bella.com' }, {
      onboarding_draft: draft,
      clinic_name_placeholder: false,
    })

    expect(result).toEqual({ saved: true, noticeStamped: false })
    const row = await rowOf(id)
    expect(row.name).toBe('Clínica Bella')
    expect(row.email).toBe('oi@bella.com')
    expect(row.settings).toEqual({
      clinic_name_placeholder: false,
      timezone: 'America/Sao_Paulo',
      onboarding_draft: draft,
    })
  })

  // A save sent on leaving the page can land after the final submit; it must
  // not put a draft back or change the clinic.
  it('changes nothing once onboarding is completed', async () => {
    const id = await insertTenant({ settings: { onboarding_completed: true } })

    const result = await saveOnboardingProgress(id, { name: 'Outro nome', phone: '(11) 98888-7777' }, {
      onboarding_draft: { step: 1 },
    })

    expect(result).toEqual({ saved: false, noticeStamped: false })
    const row = await rowOf(id)
    expect(row.name).toBe('Clínica de Ana')
    expect(row.phone).toBeNull()
    expect(row.lifecycleNoticeAt).toBeNull()
    expect(row.settings).toEqual({ onboarding_completed: true })
  })

  it('stamps the lifecycle notice with the first saved phone only', async () => {
    const id = await insertTenant({ settings: {} })

    expect(await saveOnboardingProgress(id, { name: 'Clínica Bella' }, {})).toEqual({ saved: true, noticeStamped: false })
    expect((await rowOf(id)).lifecycleNoticeAt).toBeNull()

    expect(await saveOnboardingProgress(id, { phone: '(11) 98888-7777' }, {})).toEqual({ saved: true, noticeStamped: true })
    const stampedAt = (await rowOf(id)).lifecycleNoticeAt
    expect(stampedAt).not.toBeNull()

    expect(await saveOnboardingProgress(id, { phone: '(11) 97777-6666' }, {})).toEqual({ saved: true, noticeStamped: false })
    expect((await rowOf(id)).lifecycleNoticeAt).toEqual(stampedAt)
  })
})
