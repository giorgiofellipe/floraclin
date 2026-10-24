import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/platform-whatsapp', () => ({ findPlatformTemplate: vi.fn() }))

import { findPlatformTemplate } from '@/lib/platform-whatsapp'
import {
  clearLifecycleTemplateApprovalCache,
  getLifecycleTemplateApproval,
} from '../lifecycle-template-status'

const template = (status: string) => ({ id: 'tpl-1', name: 'trial_final', status, category: 'MARKETING', rejectedReason: null })

beforeEach(() => {
  vi.resetAllMocks()
  clearLifecycleTemplateApprovalCache()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-24T13:00:00.000Z'))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('getLifecycleTemplateApproval', () => {
  it('is approved only when Meta reports APPROVED', async () => {
    vi.mocked(findPlatformTemplate).mockResolvedValue(template('APPROVED'))
    expect(await getLifecycleTemplateApproval('trial_final')).toEqual({ state: 'approved' })
  })

  it.each(['PENDING', 'REJECTED', 'PAUSED'])('is not approved with the Meta status when it is %s', async (status) => {
    vi.mocked(findPlatformTemplate).mockResolvedValue(template(status))
    expect(await getLifecycleTemplateApproval('trial_final')).toEqual({ state: 'not_approved', status })
  })

  it('is not approved with MISSING when Meta has no such template', async () => {
    vi.mocked(findPlatformTemplate).mockResolvedValue(null)
    expect(await getLifecycleTemplateApproval('trial_final')).toEqual({ state: 'not_approved', status: 'MISSING' })
  })

  it('is unknown when the lookup fails, and does not cache the failure', async () => {
    vi.mocked(findPlatformTemplate)
      .mockRejectedValueOnce(new Error('Meta API error: timeout'))
      .mockResolvedValueOnce(template('APPROVED'))

    expect(await getLifecycleTemplateApproval('trial_final')).toEqual({
      state: 'unknown',
      error: 'Meta API error: timeout',
    })
    expect(await getLifecycleTemplateApproval('trial_final')).toEqual({ state: 'approved' })
    expect(findPlatformTemplate).toHaveBeenCalledTimes(2)
  })

  it('serves a cached answer within the TTL and asks Meta again after it', async () => {
    vi.mocked(findPlatformTemplate)
      .mockResolvedValueOnce(template('PENDING'))
      .mockResolvedValueOnce(template('APPROVED'))

    expect(await getLifecycleTemplateApproval('trial_final')).toEqual({ state: 'not_approved', status: 'PENDING' })
    vi.advanceTimersByTime(4 * 60 * 1000)
    expect(await getLifecycleTemplateApproval('trial_final')).toEqual({ state: 'not_approved', status: 'PENDING' })
    expect(findPlatformTemplate).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(2 * 60 * 1000)
    expect(await getLifecycleTemplateApproval('trial_final')).toEqual({ state: 'approved' })
    expect(findPlatformTemplate).toHaveBeenCalledTimes(2)
  })

  it('caches per template name', async () => {
    vi.mocked(findPlatformTemplate).mockResolvedValue(template('APPROVED'))

    await getLifecycleTemplateApproval('trial_final')
    await getLifecycleTemplateApproval('trial_help')

    expect(findPlatformTemplate).toHaveBeenCalledTimes(2)
    expect(findPlatformTemplate).toHaveBeenNthCalledWith(2, 'trial_help')
  })
})
