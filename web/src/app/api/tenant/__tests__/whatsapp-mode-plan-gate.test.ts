import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `own_whatsapp_number` was enforced by a `disabled` prop on a radio button
 * and nothing else. This route read `whatsapp_mode` straight out of the
 * request body, so a single request moved a free tenant onto its own Meta
 * credentials.
 *
 * That is not cosmetic. `getTemplateForTenant` branches on `whatsapp_mode`,
 * so the tenant stops using the shared FloraClin number altogether. The paid
 * feature was a greyed-out button in front of an open door.
 */

const checkPlanFeatureMock = vi.fn()
const updateTenantSettingsMock = vi.fn()
const updateTenantMock = vi.fn()
const requireWriteMock = vi.fn()

vi.mock('@/lib/plans', () => ({
  checkPlanFeature: (...a: unknown[]) => checkPlanFeatureMock(...a),
}))
vi.mock('@/lib/write-access', () => ({
  requireWrite: (...a: unknown[]) => requireWriteMock(...a),
}))
vi.mock('@/lib/auth', () => ({ getAuthContext: vi.fn() }))
vi.mock('@/db/queries/tenants', () => ({
  getTenant: vi.fn(async () => ({ id: 'tenant-1', settings: {} })),
  updateTenant: (...a: unknown[]) => updateTenantMock(...a),
  updateTenantSettings: (...a: unknown[]) => updateTenantSettingsMock(...a),
}))
vi.mock('@/lib/audit', () => ({ createAuditLog: vi.fn() }))
vi.mock('@/lib/logo', () => ({ signLogoPath: vi.fn() }))
vi.mock('@/db/client', () => ({ db: {} }))
vi.mock('@/db/schema', () => ({ tenants: {} }))

import { PUT } from '../route'

const CTX = { tenantId: 'tenant-1', userId: 'user-1', role: 'owner' }

function settingsRequest(mode: 'own' | 'floraclin') {
  return new Request('http://localhost/api/tenant', {
    method: 'PUT',
    body: JSON.stringify({
      _action: 'whatsapp_settings',
      settings: {
        whatsapp_mode: mode,
        whatsapp_enabled: true,
        whatsapp_allowed_roles: ['owner'],
      },
    }),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  requireWriteMock.mockResolvedValue({ ctx: CTX, blocked: null })
  // The route 500s on a falsy tenant, so return one.
  updateTenantSettingsMock.mockResolvedValue({ id: 'tenant-1' })
  updateTenantMock.mockResolvedValue({ id: 'tenant-1' })
})

describe('whatsapp_mode is gated on the plan, not on the UI', () => {
  it('refuses own-number mode when the plan does not include it', async () => {
    checkPlanFeatureMock.mockResolvedValue(false)

    const res = await PUT(settingsRequest('own'))

    expect(res.status).toBe(402)
    // Nothing written. A partial write here would leave the tenant pointing
    // at credentials it is not entitled to use.
    expect(updateTenantSettingsMock).not.toHaveBeenCalled()
  })

  it('allows own-number mode when the plan includes it', async () => {
    checkPlanFeatureMock.mockResolvedValue(true)

    const res = await PUT(settingsRequest('own'))

    expect(res.status).toBe(200)
    expect(updateTenantSettingsMock).toHaveBeenCalled()
  })

  it('does not consult the plan for the shared number', async () => {
    // Every plan includes the shared FloraClin number, so this path must not
    // pay for a subscription lookup.
    const res = await PUT(settingsRequest('floraclin'))

    expect(res.status).toBe(200)
    expect(checkPlanFeatureMock).not.toHaveBeenCalled()
  })

  it('closes the other entry point too', async () => {
    // tenantSettingsSchema is .passthrough() and updateTenant writes settings
    // wholesale, so a plain PUT with no _action could set whatsapp_mode
    // without ever reaching the guarded branch. Gating one door and not the
    // other is the same as not gating it.
    checkPlanFeatureMock.mockResolvedValue(false)

    const res = await PUT(
      new Request('http://localhost/api/tenant', {
        method: 'PUT',
        body: JSON.stringify({
          name: 'Clínica X',
          settings: { whatsapp_mode: 'own', whatsapp_access_token: 'planted' },
        }),
      }),
    )

    expect(res.status).toBe(402)
    expect(updateTenantMock).not.toHaveBeenCalled()
  })

  it('checks the feature for the caller tenant', async () => {
    checkPlanFeatureMock.mockResolvedValue(true)

    await PUT(settingsRequest('own'))

    expect(checkPlanFeatureMock).toHaveBeenCalledWith('tenant-1', 'own_whatsapp_number')
  })
})
