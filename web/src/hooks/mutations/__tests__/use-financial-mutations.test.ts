import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createElement, type ReactNode } from 'react'
import { renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { useBulkUncancel } from '../use-financial-mutations'

const fetchMock = vi.fn()
global.fetch = fetchMock as unknown as typeof fetch

function wrap() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  // eslint-disable-next-line react/display-name -- test-only wrapper, no display name needed
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: qc }, children)
}

describe('useBulkUncancel', () => {
  beforeEach(() => {
    fetchMock.mockReset()
  })

  it('POSTs to the bulk uncancel endpoint with entryIds and reason', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true }),
    })
    const Wrapper = wrap()
    const { result } = renderHook(() => useBulkUncancel(), { wrapper: Wrapper })

    await result.current.mutateAsync({ entryIds: ['e1', 'e2'], reason: 'motivo' })

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/financial/bulk/uncancel',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entryIds: ['e1', 'e2'], reason: 'motivo' }),
      }),
    )
  })

  it('throws with the server error message on failure', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: 'Lançamento não está cancelado' }),
    })
    const Wrapper = wrap()
    const { result } = renderHook(() => useBulkUncancel(), { wrapper: Wrapper })

    await expect(
      result.current.mutateAsync({ entryIds: ['e1'], reason: 'motivo' }),
    ).rejects.toThrow('Lançamento não está cancelado')
  })
})
