// @vitest-environment node
/**
 * The booking link left onboarding for Settings, so PUT /api/tenant sets it:
 * validated here, then changed by changeBookingSlug (reservation, redirect,
 * change limit and audit; see db/queries/__tests__/booking-slugs.test.ts),
 * whose outcomes map to the answers the form shows.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { changeBookingSlugMock, getTenantMock } = vi.hoisted(() => ({
  changeBookingSlugMock: vi.fn(),
  getTenantMock: vi.fn(),
}))

vi.mock('@/lib/write-access', () => ({
  requireWrite: vi.fn(async () => ({ ctx: { tenantId: 'tenant-1', userId: 'user-1', role: 'owner' }, blocked: null })),
}))
vi.mock('@/lib/auth', () => ({ getAuthContext: vi.fn() }))
vi.mock('@/lib/plans', () => ({ checkPlanFeature: vi.fn() }))
vi.mock('@/db/queries/tenants', () => ({
  getTenant: getTenantMock,
  updateTenant: vi.fn(),
  updateTenantSettings: vi.fn(),
  isPhoneNumberIdClaimedByAnotherTenant: vi.fn(),
}))
vi.mock('@/lib/audit', () => ({ createAuditLog: vi.fn() }))
vi.mock('@/db/queries/booking-slugs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/db/queries/booking-slugs')>()),
  changeBookingSlug: changeBookingSlugMock,
}))
vi.mock('@/lib/logo', () => ({ signLogoPath: vi.fn() }))
vi.mock('@/lib/whatsapp', () => ({ verifyCredentials: vi.fn() }))
vi.mock('@/db/client', () => ({ db: {} }))

import { PUT } from '../route'

const put = (body: Record<string, unknown>) =>
  PUT(new Request('http://localhost/api/tenant', { method: 'PUT', body: JSON.stringify({ _action: 'booking_slug', ...body }) }))

beforeEach(() => {
  vi.clearAllMocks()
  getTenantMock.mockResolvedValue({ id: 'tenant-1', slug: 'clinica-de-ana', settings: {} })
  changeBookingSlugMock.mockImplementation(async ({ slug }: { slug: string }) => ({
    outcome: 'updated',
    slug,
    previousSlug: 'clinica-de-ana',
  }))
})

describe('PUT /api/tenant booking_slug', () => {
  it('changes the link for the signed-in clinic, normalised', async () => {
    const res = await put({ slug: 'Studio-Bella' })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true, slug: 'studio-bella' })
    expect(changeBookingSlugMock).toHaveBeenCalledWith({ tenantId: 'tenant-1', userId: 'user-1', slug: 'studio-bella' })
  })

  it.each([['ab'], ['com espaço'], ['-bella'], ['bella-'], ['açaí']])('refuses %j without writing', async (slug) => {
    const res = await put({ slug })
    expect(res.status).toBe(400)
    expect(changeBookingSlugMock).not.toHaveBeenCalled()
  })

  it('answers 409 when another clinic holds the link or has it reserved', async () => {
    changeBookingSlugMock.mockResolvedValue({ outcome: 'taken' })
    const res = await put({ slug: 'taken' })
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('Este link já está em uso. Escolha outro.')
  })

  // Catches the limit being enforced only by the form, or failing as a generic error.
  it('answers 429 with a message the form can show once the daily change limit is reached', async () => {
    changeBookingSlugMock.mockResolvedValue({ outcome: 'rate_limited' })
    const res = await put({ slug: 'mais-um' })
    expect(res.status).toBe(429)
    expect((await res.json()).error).toBe('Você já trocou o link 3 vezes nas últimas 24 horas. Tente de novo mais tarde.')
  })

  it('writes nothing when the link is unchanged', async () => {
    const res = await put({ slug: 'clinica-de-ana' })
    expect(res.status).toBe(200)
    expect(changeBookingSlugMock).not.toHaveBeenCalled()
  })

  it('accepts an older link shorter than today\'s minimum when it is unchanged', async () => {
    getTenantMock.mockResolvedValue({ id: 'tenant-1', slug: 'ab', settings: {} })
    const res = await put({ slug: 'ab' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true, slug: 'ab' })
    expect(changeBookingSlugMock).not.toHaveBeenCalled()
  })
})
