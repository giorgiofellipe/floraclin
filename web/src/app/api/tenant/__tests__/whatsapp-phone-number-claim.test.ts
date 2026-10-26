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
const verifyCredentialsMock = vi.fn()

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
vi.mock('@/lib/whatsapp', () => ({ verifyCredentials: (...a: unknown[]) => verifyCredentialsMock(...a) }))
vi.mock('@/lib/audit', () => ({ createAuditLog: vi.fn() }))
vi.mock('@/lib/logo', () => ({ signLogoPath: vi.fn() }))
vi.mock('@/db/client', () => ({ db: {} }))
vi.mock('@/db/schema', () => ({ tenants: {} }))

import { getTenant } from '@/db/queries/tenants'
import { PUT } from '../route'

const ownNumber = {
  whatsapp_mode: 'own',
  whatsapp_enabled: true,
  whatsapp_phone_number_id: '111',
  whatsapp_access_token: 'token-1',
  whatsapp_allowed_roles: ['owner'],
}

function put(body: unknown) {
  return PUT(new Request('http://localhost/api/tenant', { method: 'PUT', body: JSON.stringify(body) }))
}

beforeEach(() => {
  vi.clearAllMocks()
  updateTenantSettingsMock.mockResolvedValue({ id: 'tenant-1' })
  updateTenantMock.mockResolvedValue({ id: 'tenant-1' })
  verifyCredentialsMock.mockResolvedValue({ valid: true })
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

// Without proof, the first own-plan clinic to type an id took that number's
// inbound messages, and its real owner got the 409.
describe('saving an own WhatsApp number the token cannot reach', () => {
  it.each([
    ['WhatsApp settings', { _action: 'whatsapp_settings', settings: ownNumber }],
    ['clinic settings', { name: 'Clínica', settings: ownNumber }],
  ])('is refused through %s', async (_label, body) => {
    claimedMock.mockResolvedValue(false)
    verifyCredentialsMock.mockResolvedValue({ valid: false })

    const res = await put(body)

    expect(res.status).toBe(400)
    expect(verifyCredentialsMock).toHaveBeenCalledWith('111', 'token-1')
    expect(updateTenantSettingsMock).not.toHaveBeenCalled()
    expect(updateTenantMock).not.toHaveBeenCalled()
  })
})

describe('verifying an own-number claim', () => {
  // A clinic-name save resends the whole settings object; calling Meta on
  // every one would make routine saves fail whenever Graph is down.
  it('skips Meta when the claim is unchanged', async () => {
    vi.mocked(getTenant).mockResolvedValueOnce({ id: 'tenant-1', settings: ownNumber } as never)
    claimedMock.mockResolvedValue(false)

    const res = await put({ name: 'Clínica', settings: ownNumber })

    expect(res.status).toBe(200)
    expect(verifyCredentialsMock).not.toHaveBeenCalled()
  })

  // The settings form leaves the token field empty unless it is being replaced.
  it('checks a new id against the stored token when none is sent', async () => {
    vi.mocked(getTenant).mockResolvedValueOnce({
      id: 'tenant-1',
      settings: { ...ownNumber, whatsapp_access_token: 'stored-token' },
    } as never)
    claimedMock.mockResolvedValue(false)
    const { whatsapp_access_token: _omitted, ...withoutToken } = ownNumber

    const res = await put({ _action: 'whatsapp_settings', settings: { ...withoutToken, whatsapp_phone_number_id: '222' } })

    expect(res.status).toBe(200)
    expect(verifyCredentialsMock).toHaveBeenCalledWith('222', 'stored-token')
  })
})
