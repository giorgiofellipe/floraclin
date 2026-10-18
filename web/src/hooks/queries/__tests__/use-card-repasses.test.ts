import { describe, it, expect, vi } from 'vitest'
import { createElement, type ReactNode } from 'react'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { useAdjustCardRepasse } from '../use-card-repasses'
import { queryKeys } from '../query-keys'

global.fetch = vi.fn().mockResolvedValue(new Response('{}', { status: 200 })) as unknown as typeof fetch

describe('useAdjustCardRepasse', () => {
  // Adjusting a repasse changes net received money, which the dashboard card fee total reads.
  it('invalidates the financial and dashboard caches on success', async () => {
    const qc = new QueryClient()
    const spy = vi.spyOn(qc, 'invalidateQueries')
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: qc }, children)
    const { result } = renderHook(() => useAdjustCardRepasse(), { wrapper })

    await result.current.mutateAsync({ id: 'r1', netAmount: 90, expectedDate: '2026-10-20' })

    await waitFor(() => {
      expect(spy).toHaveBeenCalledWith({ queryKey: queryKeys.financial.all })
      expect(spy).toHaveBeenCalledWith({ queryKey: queryKeys.dashboard })
    })
  })
})
