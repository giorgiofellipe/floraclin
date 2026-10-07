import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createElement, type ReactNode } from 'react'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { useInstallmentQuote } from '../use-installment-quote'

const fetchMock = vi.fn()
global.fetch = fetchMock as unknown as typeof fetch

function wrap() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  // eslint-disable-next-line react/display-name -- test-only wrapper, no display name needed
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: qc }, children)
}

describe('useInstallmentQuote', () => {
  beforeEach(() => {
    fetchMock.mockReset()
  })

  it('fetches with no query string when paidAt is undefined', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, data: { amount: 100 } }),
    })

    const { result } = renderHook(() => useInstallmentQuote('inst-1'), { wrapper: wrap() })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(fetchMock).toHaveBeenCalledWith('/api/financial/installments/inst-1/quote')
  })

  it('appends an encoded paidAt query string when given', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, data: { amount: 100 } }),
    })

    const { result } = renderHook(() => useInstallmentQuote('inst-1', '2026-05-01T12:00:00.000Z'), {
      wrapper: wrap(),
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/financial/installments/inst-1/quote?paidAt=2026-05-01T12%3A00%3A00.000Z',
    )
  })

  it('returns body.data on success, not the whole envelope', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, data: { amount: 250, penalty: 10 } }),
    })

    const { result } = renderHook(() => useInstallmentQuote('inst-1'), { wrapper: wrap() })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(result.current.data).toEqual({ amount: 250, penalty: 10 })
  })

  it('throws with the server error message on a non-ok response', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({ error: 'Parcela não encontrada' }),
    })

    const { result } = renderHook(() => useInstallmentQuote('inst-1'), { wrapper: wrap() })

    await waitFor(() => expect(result.current.isError).toBe(true))

    expect(result.current.error?.message).toBe('Parcela não encontrada')
  })

  it('falls back to HTTP <status> when the body has no error field', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({}),
    })

    const { result } = renderHook(() => useInstallmentQuote('inst-1'), { wrapper: wrap() })

    await waitFor(() => expect(result.current.isError).toBe(true))

    expect(result.current.error?.message).toBe('HTTP 500')
  })

  it('does not fetch when enabled is false', async () => {
    const { result } = renderHook(() => useInstallmentQuote('inst-1', undefined, false), {
      wrapper: wrap(),
    })

    expect(result.current.isFetching).toBe(false)
    expect(result.current.fetchStatus).toBe('idle')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
