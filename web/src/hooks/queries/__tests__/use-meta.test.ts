import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createElement, type ReactNode } from 'react'
import { renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { useTestMetaConnection } from '../use-meta'

const fetchMock = vi.fn()
global.fetch = fetchMock as unknown as typeof fetch

function wrap() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  // eslint-disable-next-line react/display-name -- test-only wrapper, no display name needed
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: qc }, children)
}

function renderTestHook() {
  return renderHook(() => useTestMetaConnection(), { wrapper: wrap() })
}

describe('useTestMetaConnection', () => {
  beforeEach(() => {
    fetchMock.mockReset()
  })

  // The route answers 200 with Meta's verdict in the body. Reading res.ok
  // here is what told a clinic its broken integration was fine.
  it('reports a body-level ok:false as a failure even on HTTP 200', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          ok: false,
          kind: 'invalid',
          message: 'Invalid parameter',
          fbTraceId: 'A3ip2Ls_KK6lBhQHO3k079_',
        }),
        { status: 200 },
      ),
    )

    const { result } = renderTestHook()
    const outcome = await result.current.mutateAsync()

    expect(outcome.ok).toBe(false)
    expect(outcome).toEqual({
      ok: false,
      message: 'Invalid parameter',
      errorUserTitle: undefined,
      fbTraceId: 'A3ip2Ls_KK6lBhQHO3k079_',
    })
  })

  it("surfaces Meta's own explanation when it sends one", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          ok: false,
          kind: 'invalid',
          message: 'O campo user_data precisa de ao menos um identificador.',
          errorUserTitle: 'Parâmetro inválido',
          fbTraceId: 'trace-1',
        }),
        { status: 200 },
      ),
    )

    const { result } = renderTestHook()
    const outcome = await result.current.mutateAsync()

    expect(outcome).toEqual({
      ok: false,
      message: 'O campo user_data precisa de ao menos um identificador.',
      errorUserTitle: 'Parâmetro inválido',
      fbTraceId: 'trace-1',
    })
  })

  it('reports an accepted event as a success', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true, eventsReceived: 1, fbTraceId: 'trace-2' }), {
        status: 200,
      }),
    )

    const { result } = renderTestHook()
    const outcome = await result.current.mutateAsync()

    expect(outcome).toEqual({ ok: true, eventsReceived: 1, fbTraceId: 'trace-2' })
  })

  // Our own route refusing before it reached Meta is a third case: there is
  // no verdict at all, so the mutation rejects instead of returning one.
  it('throws when our own route refuses the request', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'Nenhuma conexão configurada.' }), { status: 404 }),
    )

    const { result } = renderTestHook()

    await expect(result.current.mutateAsync()).rejects.toThrow('Nenhuma conexão configurada.')
  })
})
