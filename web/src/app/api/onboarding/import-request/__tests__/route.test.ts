import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq, inArray } from 'drizzle-orm'
import { db } from '@/db/client'
import { tenants } from '@/db/schema'
import { sendDiscordNow } from '@/lib/discord'
import { ForbiddenError } from '@/lib/errors'

const RUN_INTEGRATION = Boolean(process.env.DATABASE_URL_TEST || process.env.RUN_DB_TESTS)
const describeIntegration = RUN_INTEGRATION ? describe : describe.skip

const auth = vi.hoisted(() => ({ tenantId: '', userId: '', role: 'owner', email: 'ana@clinica.test', isPlatformAdmin: false }))
vi.mock('@/lib/auth', () => ({
  requireRole: vi.fn(async (...roles: string[]) => {
    if (!roles.includes(auth.role)) throw new ForbiddenError()
    return { ...auth }
  }),
}))
vi.mock('@/lib/plans', () => ({ subscriptionGate: vi.fn(async () => null) }))
vi.mock('@/lib/discord', () => ({ sendDiscordNow: vi.fn(async () => true) }))

import { POST } from '../route'

function post() {
  return POST(new Request('http://localhost/api/onboarding/import-request', { method: 'POST' }))
}

async function storedSettings() {
  const [row] = await db.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, auth.tenantId))
  return row.settings as Record<string, unknown>
}

describeIntegration('POST /api/onboarding/import-request (integration, requires test DB)', () => {
  const tenantIds: string[] = []

  beforeEach(async () => {
    auth.tenantId = randomUUID()
    auth.userId = randomUUID()
    auth.role = 'owner'
    auth.isPlatformAdmin = false
    vi.mocked(sendDiscordNow).mockReset().mockResolvedValue(true)
    await db.insert(tenants).values({
      id: auth.tenantId,
      name: 'Clínica Bela',
      slug: `import-${auth.tenantId}`,
      phone: '11987654321',
      settings: { online_booking_enabled: true },
    })
    tenantIds.push(auth.tenantId)
  })

  afterEach(async () => {
    await db.delete(tenants).where(inArray(tenants.id, tenantIds.splice(0)))
  })

  it.each([
    ['a non-owner', () => { auth.role = 'receptionist' }],
    ['a platform admin, who resolves as owner in any clinic', () => { auth.isPlatformAdmin = true }],
  ])('refuses %s and records nothing', async (_who, arrange) => {
    arrange()

    const res = await post()

    expect(res.status).toBe(403)
    expect(await storedSettings()).toEqual({ online_booking_enabled: true })
    expect(sendDiscordNow).not.toHaveBeenCalled()
  })

  it('clears the request when the team could not be told, so a retry notifies once', async () => {
    vi.mocked(sendDiscordNow).mockResolvedValueOnce(false)

    const failed = await post()

    expect(failed.status).toBe(502)
    expect(await failed.json()).toEqual({ error: 'Não foi possível enviar agora. Tente de novo.' })
    expect(await storedSettings()).toEqual({ online_booking_enabled: true })

    const retried = await post()

    expect(retried.status).toBe(200)
    expect(typeof (await storedSettings()).import_help_requested_at).toBe('string')
    expect(sendDiscordNow).toHaveBeenCalledTimes(2)
  })

  it('notifies the team once when two requests race, and both get the stored time', async () => {
    const responses = await Promise.all([post(), post()])
    const bodies = await Promise.all(responses.map((r) => r.json()))

    const settings = await storedSettings()
    expect(settings.online_booking_enabled).toBe(true)
    expect(typeof settings.import_help_requested_at).toBe('string')
    expect(bodies).toEqual([
      { requestedAt: settings.import_help_requested_at },
      { requestedAt: settings.import_help_requested_at },
    ])
    expect(sendDiscordNow).toHaveBeenCalledTimes(1)
    expect(sendDiscordNow).toHaveBeenCalledWith({
      kind: 'onboarding.import_requested',
      tenantId: auth.tenantId,
      tenantName: 'Clínica Bela',
      phone: '11987654321',
      ownerEmail: 'ana@clinica.test',
    })
  })
})
