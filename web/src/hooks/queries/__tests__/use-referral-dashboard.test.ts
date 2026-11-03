import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { focusManager } from '@tanstack/react-query'
import { createWrapper } from '@/tests/test-utils'
import { makeQueryClient } from '@/lib/react-query'
import { useReferralDashboard } from '../use-referral-dashboard'

afterEach(() => {
  vi.unstubAllGlobals()
  focusManager.setFocused(undefined)
})

describe('useReferralDashboard', () => {
  it('refetches when the window regains focus, so a subscription changed elsewhere shows up', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ subscribeToUnlock: true }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ subscribeToUnlock: false }) })
    vi.stubGlobal('fetch', fetchMock)
    const queryClient = makeQueryClient()

    const { result } = renderHook(() => useReferralDashboard(), { wrapper: createWrapper(queryClient) })
    await waitFor(() => expect(result.current.data?.subscribeToUnlock).toBe(true))

    act(() => {
      focusManager.setFocused(false)
      focusManager.setFocused(true)
    })

    await waitFor(() => expect(result.current.data?.subscribeToUnlock).toBe(false))
  })
})
