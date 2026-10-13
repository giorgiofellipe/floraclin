import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createElement, type ReactNode } from 'react'
import { renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { ApiError, useBulkUncancel, usePayInstallment } from '../use-financial-mutations'

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
})

describe('usePayInstallment', () => {
  beforeEach(() => {
    fetchMock.mockReset()
  })

  it('PUTs the amount, method, date, notes, the quoted total and the overpayment confirmation', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true }),
    })
    const Wrapper = wrap()
    const { result } = renderHook(() => usePayInstallment(), { wrapper: Wrapper })

    await result.current.mutateAsync({
      id: 'inst-1',
      amount: 790.75,
      paymentMethod: 'pix',
      paidAt: undefined,
      notes: undefined,
      expectedTotalDue: 790.75,
      acceptOverpayment: true,
    })

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/financial/installments/inst-1/pay',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ amount: 790.75, paymentMethod: 'pix', expectedTotalDue: 790.75, acceptOverpayment: true }),
      }),
    )
  })

  // The dialog branches on the code to refetch the quote, so the code has to
  // survive the throw and not only the message.
  it('throws an ApiError carrying the code from a 409 body', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 409,
      json: async () => ({ error: 'O total pendente mudou', code: 'QUOTE_CHANGED' }),
    })
    const Wrapper = wrap()
    const { result } = renderHook(() => usePayInstallment(), { wrapper: Wrapper })

    const error = await result.current
      .mutateAsync({ id: 'inst-1', amount: 1, paymentMethod: 'pix', expectedTotalDue: 1 })
      .catch((e: unknown) => e)

    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ message: 'O total pendente mudou', code: 'QUOTE_CHANGED' })
  })

  it('throws an ApiError without a code when the body has none', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({}),
    })
    const Wrapper = wrap()
    const { result } = renderHook(() => usePayInstallment(), { wrapper: Wrapper })

    const error = await result.current
      .mutateAsync({ id: 'inst-1', amount: 1, paymentMethod: 'pix', expectedTotalDue: 1 })
      .catch((e: unknown) => e)

    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ message: 'HTTP 500', code: undefined })
  })
})
