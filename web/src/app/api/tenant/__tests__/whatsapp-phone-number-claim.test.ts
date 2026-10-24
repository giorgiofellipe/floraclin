import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The own-number webhook picks the tenant by the phone_number_id in settings,
 * and any owner could save any id. A second clinic saving another clinic's id
 * made routing between the two undefined: either inbox could receive the other
 * clinic's patient messages. Both settings write paths must refuse it.
 */

const updateTenantSettingsMock = vi.fn()
const updateTenantMock = vi.fn()
const claimedMock = vi.fn()

vi.mock('@/lib/plans', () => ({ checkPlanFeature: vi.fn(async () => true) }))
vi.mock('@/lib/write-access', () => ({
  requireWrite: vi.fn(async () => ({ ctx: { tenantId: 'tenant-1', userId: 'user-1', role: 'owner' }, blocked: null })),
}))
vi.mock('@/lib/auth', () => ({ getAuthContext: vi.fn() }))
vi.mock('@/db/queries/tenants', () => ({
  getTenant: vi.fn(async () => ({ id: 'tenant-1', settings: {} })),
  updateTenant: (...a: unknown[]) => updateTenantMock(...a),
  updateTenantSettings: (...a: unknown[]) => updateTenantSettingsMock(...a),
  isPhoneNumberIdClaimedByAnotherTenant: (...a: unknown[]) => claimedMock(...a),
}))
vi.mock('@/lib/audit', () => ({ createAuditLog: vi.fn() }))
vi.mock('@/lib/logo', () => ({ signLogoPath: vi.fn() }))
vi.mock('@/db/client', () => ({ db: {} }))
vi.mock('@/db/schema', () => ({ tenants: {} }))

import { PUT } from '../route'

const ownNumber = { whatsapp_mode: 'own', whatsapp_enabled: true, whatsapp_phone_number_id: '111', whatsapp_allowed_roles: ['owner'] }

function put(body: unknown) {
  return PUT(new Request('http://localhost/api/tenant', { method: 'PUT', body: JSON.stringify(body) }))
}

beforeEach(() => {
  vi.clearAllMocks()
  updateTenantSettingsMock.mockResolvedValue({ id: 'tenant-1' })
  updateTenantMock.mockResolvedValue({ id: 'tenant-1' })
})

describe('saving an own WhatsApp number another clinic already holds', () => {
  it.each([
    ['WhatsApp settings', { _action: 'whatsapp_settings', settings: ownNumber }],
    ['clinic settings', { name: 'Clínica', settings: ownNumber }],
  ])('is refused through %s', async (_label, body) => {
    claimedMock.mockResolvedValue(true)

    const res = await put(body)

    expect(res.status).toBe(409)
    expect(claimedMock).toHaveBeenCalledWith('tenant-1', '111')
    expect(updateTenantSettingsMock).not.toHaveBeenCalled()
    expect(updateTenantMock).not.toHaveBeenCalled()
  })

  it('is saved when no other clinic holds it', async () => {
    claimedMock.mockResolvedValue(false)

    const res = await put({ _action: 'whatsapp_settings', settings: ownNumber })

    expect(res.status).toBe(200)
    expect(updateTenantSettingsMock).toHaveBeenCalled()
  })
})
