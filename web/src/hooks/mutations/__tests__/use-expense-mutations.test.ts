import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createElement, type ReactNode } from 'react'
import { renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useRevertExpenseInstallment, useUpdateExpense } from '../use-expense-mutations'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))

const fetchMock = vi.fn()
global.fetch = fetchMock as unknown as typeof fetch

function wrap() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  // eslint-disable-next-line react/display-name -- test-only wrapper, no display name needed
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: qc }, children)
}

describe('useRevertExpenseInstallment', () => {
  beforeEach(() => {
    fetchMock.mockReset()
  })

  it('DELETEs to the pay endpoint with reason', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, data: { id: 'inst-1' } }),
    })
    const Wrapper = wrap()
    const { result } = renderHook(() => useRevertExpenseInstallment(), { wrapper: Wrapper })

    await result.current.mutateAsync({ id: 'inst-1', reason: 'motivo' })

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/expenses/installments/inst-1/pay',
      expect.objectContaining({
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'motivo' }),
      }),
    )
  })

  it('sends empty object body when no reason', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true }),
    })
    const Wrapper = wrap()
    const { result } = renderHook(() => useRevertExpenseInstallment(), { wrapper: Wrapper })
    await result.current.mutateAsync({ id: 'inst-1' })

    const body = fetchMock.mock.calls[0][1].body
    expect(body).toBe('{}')
  })

  it('throws with error message on non-ok response', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: 'Parcela não está paga' }),
    })
    const Wrapper = wrap()
    const { result } = renderHook(() => useRevertExpenseInstallment(), { wrapper: Wrapper })

    await expect(result.current.mutateAsync({ id: 'inst-1' })).rejects.toThrow('Parcela não está paga')
  })
})

describe('useUpdateExpense', () => {
  beforeEach(() => {
    fetchMock.mockReset()
  })

  it('PUTs to /api/expenses/:id with the payload minus id', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true }),
    })
    const Wrapper = wrap()
    const { result } = renderHook(() => useUpdateExpense(), { wrapper: Wrapper })

    await result.current.mutateAsync({
      id: 'exp-1',
      description: 'Aluguel',
      categoryId: 'cat-1',
      notes: 'note',
      totalAmount: 1000,
      installmentCount: 5,
      unpaidDueDates: ['2026-05-01', '2026-06-01', '2026-07-01'],
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/expenses/exp-1')
    expect(init.method).toBe('PUT')
    const body = JSON.parse(init.body)
    expect(body).toEqual({
      description: 'Aluguel',
      categoryId: 'cat-1',
      notes: 'note',
      totalAmount: 1000,
      installmentCount: 5,
      unpaidDueDates: ['2026-05-01', '2026-06-01', '2026-07-01'],
    })
    expect(body).not.toHaveProperty('id')
  })

  it('throws with error message on non-ok response', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: 'Valor menor que o já pago' }),
    })
    const Wrapper = wrap()
    const { result } = renderHook(() => useUpdateExpense(), { wrapper: Wrapper })

    await expect(
      result.current.mutateAsync({
        id: 'exp-1',
        description: 'x',
        categoryId: 'cat-1',
        totalAmount: 100,
        installmentCount: 5,
        unpaidDueDates: [],
      }),
    ).rejects.toThrow('Valor menor que o já pago')
  })
})
