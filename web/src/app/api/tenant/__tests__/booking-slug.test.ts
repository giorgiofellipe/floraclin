// @vitest-environment node
/**
 * The booking link left onboarding for Settings, so PUT /api/tenant sets it:
 * validated, collision-safe through the unique index (a race included), and
 * audited.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { updateWhereMock, createAuditLogMock, getTenantMock } = vi.hoisted(() => ({
  updateWhereMock: vi.fn(),
  createAuditLogMock: vi.fn(),
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
vi.mock('@/lib/audit', () => ({ createAuditLog: createAuditLogMock }))
vi.mock('@/lib/logo', () => ({ signLogoPath: vi.fn() }))
vi.mock('@/lib/whatsapp', () => ({ verifyCredentials: vi.fn() }))
vi.mock('@/db/client', () => ({
  db: { update: vi.fn(() => ({ set: vi.fn(() => ({ where: updateWhereMock })) })) },
}))

import { db } from '@/db/client'
import { PUT } from '../route'

const put = (body: Record<string, unknown>) =>
  PUT(new Request('http://localhost/api/tenant', { method: 'PUT', body: JSON.stringify({ _action: 'booking_slug', ...body }) }))

beforeEach(() => {
  vi.clearAllMocks()
  getTenantMock.mockResolvedValue({ id: 'tenant-1', slug: 'clinica-de-ana', settings: {} })
  updateWhereMock.mockResolvedValue(undefined)
})

describe('PUT /api/tenant booking_slug', () => {
  it('saves a valid link and records old and new in the audit log', async () => {
    const res = await put({ slug: 'Studio-Bella' })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true, slug: 'studio-bella' })
    const set = vi.mocked(db.update).mock.results[0].value.set
    expect(set).toHaveBeenCalledWith(expect.objectContaining({ slug: 'studio-bella' }))
    expect(createAuditLogMock).toHaveBeenCalledWith(
      expect.objectContaining({ changes: { slug: { old: 'clinica-de-ana', new: 'studio-bella' } } }),
    )
  })

  it.each([['ab'], ['com espaço'], ['-bella'], ['bella-'], ['açaí']])('refuses %j without writing', async (slug) => {
    const res = await put({ slug })
    expect(res.status).toBe(400)
    expect(db.update).not.toHaveBeenCalled()
  })

  it('answers 409 when another clinic holds the link', async () => {
    updateWhereMock.mockRejectedValue(
      new Error('Failed query', { cause: { code: '23505', constraint_name: 'tenants_slug_unique' } }),
    )
    const res = await put({ slug: 'taken' })
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('Este link já está em uso. Escolha outro.')
    expect(createAuditLogMock).not.toHaveBeenCalled()
  })

  it('writes nothing when the link is unchanged', async () => {
    const res = await put({ slug: 'clinica-de-ana' })
    expect(res.status).toBe(200)
    expect(db.update).not.toHaveBeenCalled()
  })
})
