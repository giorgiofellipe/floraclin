import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth', () => ({ getAuthContext: vi.fn() }))
vi.mock('@/db/queries/subscriptions', () => ({ getSubscription: vi.fn() }))
vi.mock('@/lib/referral/config', () => ({ isReferralEnrollmentEnabled: vi.fn() }))
vi.mock('@/lib/referral/attribution', () => ({ attributeReferral: vi.fn() }))
vi.mock('@/lib/stripe', () => ({ prepareReferralAttach: vi.fn() }))

import { getAuthContext } from '@/lib/auth'
import { getSubscription } from '@/db/queries/subscriptions'
import { isReferralEnrollmentEnabled } from '@/lib/referral/config'
import { attributeReferral, type AttributionResult } from '@/lib/referral/attribution'
import { prepareReferralAttach } from '@/lib/stripe'
import { POST } from '../attach/route'

const request = (body: unknown = { code: 'MECA7K' }) =>
  new Request('http://localhost/api/referral/attach', { method: 'POST', body: JSON.stringify(body) })

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getAuthContext).mockResolvedValue({ tenantId: 'tenant-1', userId: 'u1', role: 'owner' } as never)
  vi.mocked(isReferralEnrollmentEnabled).mockReturnValue(true)
  vi.mocked(getSubscription).mockResolvedValue({ firstPaidAt: null, stripeSubscriptionId: null } as never)
  vi.mocked(prepareReferralAttach).mockResolvedValue({ hasSubscription: false })
})

describe('POST /api/referral/attach', () => {
  it('403 for a non-owner', async () => {
    vi.mocked(getAuthContext).mockResolvedValue({ tenantId: 'tenant-1', role: 'secretary' } as never)
    expect((await POST(request())).status).toBe(403)
    expect(attributeReferral).not.toHaveBeenCalled()
  })

  it('404 with the switch off', async () => {
    vi.mocked(isReferralEnrollmentEnabled).mockReturnValue(false)
    expect((await POST(request())).status).toBe(404)
    expect(attributeReferral).not.toHaveBeenCalled()
  })

  it('400 when Stripe already has a subscription whose webhook has not landed yet', async () => {
    vi.mocked(prepareReferralAttach).mockResolvedValue({ hasSubscription: true })
    const res = await POST(request())
    expect(res.status).toBe(400)
    expect(attributeReferral).not.toHaveBeenCalled()
  })

  it.each([{ firstPaidAt: new Date() }, { stripeSubscriptionId: 'sub_1' }])('400 after the first payment (%o)', async (sub) => {
    vi.mocked(getSubscription).mockResolvedValue({ firstPaidAt: null, stripeSubscriptionId: null, ...sub } as never)
    const res = await POST(request())
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('O código de indicação só pode ser informado antes do primeiro pagamento.')
    expect(attributeReferral).not.toHaveBeenCalled()
  })

  it.each<[string, AttributionResult, number, Record<string, string>]>([
    ['trial', { outcome: 'created', referralId: 'r1', status: 'trial' }, 200, { status: 'trial' }],
    ['ineligible', { outcome: 'created', referralId: 'r1', status: 'ineligible' }, 200, { status: 'ineligible' }],
    ['invalid', { outcome: 'skipped', reason: 'invalid_code' }, 400, { error: 'Código de indicação inválido ou inativo.' }],
    ['unknown', { outcome: 'skipped', reason: 'unknown_or_inactive' }, 400, { error: 'Código de indicação inválido ou inativo.' }],
    ['no code', { outcome: 'skipped', reason: 'no_code' }, 400, { error: 'Código de indicação inválido ou inativo.' }],
    ['already', { outcome: 'skipped', reason: 'already_attributed' }, 400, { error: 'Sua clínica já tem uma indicação registrada.' }],
    ['same tenant', { outcome: 'skipped', reason: 'same_tenant' }, 400, { error: 'Você não pode usar o código da sua própria clínica.' }],
  ])('maps %s', async (_label, result, status, body) => {
    vi.mocked(attributeReferral).mockResolvedValue(result)
    const res = await POST(request())
    expect(res.status).toBe(status)
    expect(await res.json()).toEqual(body)
    expect(attributeReferral).toHaveBeenCalledWith({ referredTenantId: 'tenant-1', rawCode: 'MECA7K', capturedVia: 'billing_page' })
  })
})
