import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth', () => ({ getAuthContext: vi.fn() }))
// Real role check over the mocked auth context; the subscription gate passes (canRefer is stricter, tested below).
vi.mock('@/lib/write-access', async () => {
  const { getAuthContext } = await import('@/lib/auth')
  const { ForbiddenError } = await import('@/lib/errors')
  return {
    requireWrite: vi.fn(async (...roles: string[]) => {
      const ctx = await getAuthContext()
      if (!roles.includes(ctx.role)) throw new ForbiddenError()
      return { ctx, blocked: null }
    }),
  }
})
vi.mock('@/db/queries/subscriptions', () => ({ getSubscription: vi.fn() }))
vi.mock('@/db/queries/referrals', () => ({ isReferralCodeAvailable: vi.fn(), updateReferralCode: vi.fn() }))
vi.mock('@/lib/referral/config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/referral/config')>()),
  isReferralEnrollmentEnabled: vi.fn(),
}))

import { getAuthContext } from '@/lib/auth'
import { getSubscription } from '@/db/queries/subscriptions'
import { isReferralCodeAvailable, updateReferralCode } from '@/db/queries/referrals'
import { isReferralEnrollmentEnabled } from '@/lib/referral/config'
import { CUSTOM_CODE_MESSAGES } from '@/lib/referral/custom-code'
import { requireWrite } from '@/lib/write-access'
import { GET, PUT } from '../code/route'

const check = (code: string) => GET(new Request(`http://localhost/api/referral/code?code=${encodeURIComponent(code)}`))
const save = (body: unknown) =>
  PUT(new Request('http://localhost/api/referral/code', { method: 'PUT', body: JSON.stringify(body) }))

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getAuthContext).mockResolvedValue({ tenantId: 'tenant-1', userId: 'user-1', role: 'owner' } as never)
  vi.mocked(isReferralEnrollmentEnabled).mockReturnValue(true)
  vi.mocked(getSubscription).mockResolvedValue({ source: 'stripe', status: 'active' } as never)
  vi.mocked(isReferralCodeAvailable).mockResolvedValue(true)
})

describe('/api/referral/code access', () => {
  it('PUT goes through the write gate as owner, and returns its block as-is', async () => {
    vi.mocked(requireWrite).mockResolvedValueOnce({ ctx: null, blocked: Response.json({ error: 'x' }, { status: 402 }) } as never)
    expect((await save({ code: 'DRAMICAELA' })).status).toBe(402)
    expect(requireWrite).toHaveBeenCalledWith('owner')
    expect(updateReferralCode).not.toHaveBeenCalled()
  })

  it('403 for a non-owner, before any lookup', async () => {
    vi.mocked(getAuthContext).mockResolvedValue({ tenantId: 'tenant-1', userId: 'u', role: 'secretary' } as never)
    expect((await check('DRAMICAELA')).status).toBe(403)
    expect((await save({ code: 'DRAMICAELA' })).status).toBe(403)
    expect(getSubscription).not.toHaveBeenCalled()
    expect(updateReferralCode).not.toHaveBeenCalled()
  })

  it('404 with the switch off', async () => {
    vi.mocked(isReferralEnrollmentEnabled).mockReturnValue(false)
    expect((await save({ code: 'DRAMICAELA' })).status).toBe(404)
    expect(updateReferralCode).not.toHaveBeenCalled()
  })

  it('403 for a clinic that cannot refer (not paying through Stripe)', async () => {
    vi.mocked(getSubscription).mockResolvedValue({ source: 'admin', status: 'active' } as never)
    expect((await save({ code: 'DRAMICAELA' })).status).toBe(403)
    vi.mocked(getSubscription).mockResolvedValue({ source: 'stripe', status: 'past_due' } as never)
    expect((await check('DRAMICAELA')).status).toBe(403)
    expect(updateReferralCode).not.toHaveBeenCalled()
    expect(isReferralCodeAvailable).not.toHaveBeenCalled()
  })
})

describe('GET /api/referral/code (availability)', () => {
  it('normalises and checks against the caller tenant only', async () => {
    const res = await check(' draMicaela ')
    expect(await res.json()).toEqual({ available: true, code: 'DRAMICAELA' })
    expect(isReferralCodeAvailable).toHaveBeenCalledWith('tenant-1', 'DRAMICAELA')
  })

  it('reports a taken code', async () => {
    vi.mocked(isReferralCodeAvailable).mockResolvedValue(false)
    expect(await (await check('DRAMICAELA')).json()).toEqual({
      available: false,
      reason: 'taken',
      message: CUSTOM_CODE_MESSAGES.taken,
    })
  })

  it('reports format and reserved problems without touching the DB', async () => {
    expect((await (await check('AB')).json()).reason).toBe('format')
    expect((await (await check('indica20')).json()).reason).toBe('reserved')
    expect(isReferralCodeAvailable).not.toHaveBeenCalled()
  })
})

describe('PUT /api/referral/code', () => {
  it('saves the normalised code for the caller tenant and user', async () => {
    vi.mocked(updateReferralCode).mockResolvedValue({ outcome: 'updated', code: 'DRAMICAELA', previousCode: 'MECA7K' })
    const res = await save({ code: 'dramicaela', tenantId: 'someone-else' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ code: 'DRAMICAELA' })
    expect(updateReferralCode).toHaveBeenCalledWith({ tenantId: 'tenant-1', userId: 'user-1', code: 'DRAMICAELA' })
  })

  it.each([
    [{ code: 'FLORACLIN' }, CUSTOM_CODE_MESSAGES.reserved],
    [{ code: 'DRA MICA' }, CUSTOM_CODE_MESSAGES.format],
    [null, CUSTOM_CODE_MESSAGES.format],
  ])('400 for %j', async (body, error) => {
    const res = await save(body)
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error })
    expect(updateReferralCode).not.toHaveBeenCalled()
  })

  it('409 with a friendly message when another clinic got the code first', async () => {
    vi.mocked(updateReferralCode).mockResolvedValue({ outcome: 'taken' })
    const res = await save({ code: 'DRAMICAELA' })
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: CUSTOM_CODE_MESSAGES.taken })
  })

  it('429 past the daily change limit', async () => {
    vi.mocked(updateReferralCode).mockResolvedValue({ outcome: 'rate_limited' })
    const res = await save({ code: 'DRAMICAELA' })
    expect(res.status).toBe(429)
    expect(await res.json()).toEqual({ error: CUSTOM_CODE_MESSAGES.rateLimited })
  })

  it('409 with the alias-limit message once the clinic has too many old codes', async () => {
    vi.mocked(updateReferralCode).mockResolvedValue({ outcome: 'alias_limit' })
    const res = await save({ code: 'DRAMICAELA' })
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: CUSTOM_CODE_MESSAGES.aliasLimit })
  })
})
