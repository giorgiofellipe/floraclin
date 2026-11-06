import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/write-access', () => ({
  requireWrite: vi.fn(async () => ({ ctx: { tenantId: 'tenant-1', userId: 'user-1' }, blocked: null })),
}))
vi.mock('@/db/queries/tenants', () => ({
  saveOnboardingProgress: vi.fn(async () => ({ saved: true, noticeStamped: false })),
}))
vi.mock('@/lib/lifecycle-sender', () => ({ scheduleLifecycleWelcome: vi.fn() }))

import { saveOnboardingProgress } from '@/db/queries/tenants'
import { scheduleLifecycleWelcome } from '@/lib/lifecycle-sender'
import { PATCH } from '../route'

function patchProgress(body: Record<string, unknown>) {
  return PATCH(new Request('http://localhost/api/onboarding/progress', {
    method: 'PATCH',
    body: JSON.stringify(body),
  }))
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('PATCH /api/onboarding/progress', () => {
  it('saves the name, the phone and the draft', async () => {
    const draft = {
      step: 2,
      procedures: [{ selected: false, durationMin: 30, defaultPrice: '150,00' }],
      selectedProductNames: ['Botox 100U'],
      productsTouched: true,
      customProducts: [],
    }

    const res = await patchProgress({
      clinic: { name: 'Clínica Bella', phone: '(11) 98888-7777' },
      draft,
    })

    expect(res.status).toBe(200)
    const [, clinic, settings] = vi.mocked(saveOnboardingProgress).mock.calls[0]
    expect(clinic).toEqual({ name: 'Clínica Bella', phone: '(11) 98888-7777' })
    expect(settings).toEqual({ onboarding_draft: draft, clinic_name_placeholder: false })
  })

  it.each([
    ['without DDD', '9888-7777'],
    ['half typed', '(11) 9888'],
    ['empty', ''],
  ])('never stores a phone %s', async (_label, phone) => {
    const res = await patchProgress({ clinic: { name: 'Clínica Bella', phone } })

    expect(res.status).toBe(200)
    const [, clinic] = vi.mocked(saveOnboardingProgress).mock.calls[0]
    expect(clinic).toEqual({ name: 'Clínica Bella' })
  })

  // Regression: one draft field over its limit failed the whole save, and the
  // valid phone typed with it was lost.
  it('still saves the phone when the draft is invalid', async () => {
    const res = await patchProgress({
      clinic: { phone: '(11) 98888-7777' },
      draft: { step: 1, procedures: [], selectedProductNames: ['a'.repeat(151)], productsTouched: false, customProducts: [] },
    })

    expect(res.status).toBe(200)
    const [, clinic, settings] = vi.mocked(saveOnboardingProgress).mock.calls[0]
    expect(clinic).toEqual({ phone: '(11) 98888-7777' })
    expect(settings).toEqual({})
  })

  it('clears the stand-in name flag with the first saved name', async () => {
    await patchProgress({ clinic: { name: '  Clínica Bella ' } })
    await patchProgress({ clinic: { name: '   ' } })

    expect(vi.mocked(saveOnboardingProgress).mock.calls[0][2]).toEqual({ clinic_name_placeholder: false })
    expect(vi.mocked(saveOnboardingProgress).mock.calls[1][2]).toEqual({})
  })

  it('sends the held trial welcome only on the save that stamped the notice', async () => {
    vi.mocked(saveOnboardingProgress)
      .mockResolvedValueOnce({ saved: true, noticeStamped: true })
      .mockResolvedValueOnce({ saved: true, noticeStamped: false })

    await patchProgress({ clinic: { phone: '(11) 98888-7777' } })
    await patchProgress({ clinic: { phone: '(11) 98888-7777' } })

    expect(scheduleLifecycleWelcome).toHaveBeenCalledTimes(1)
    expect(scheduleLifecycleWelcome).toHaveBeenCalledWith({ tenantId: 'tenant-1' })
  })
})
