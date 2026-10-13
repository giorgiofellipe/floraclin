import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createElement, type ReactNode } from 'react'
import { renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AnamnesisSaveError, useUpsertAnamnesis } from '../use-anamnesis-mutations'

const fetchMock = vi.fn()

function wrap() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  // eslint-disable-next-line react/display-name -- test-only wrapper
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: qc }, children)
}

describe('useUpsertAnamnesis', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => vi.unstubAllGlobals())

  // Regression: the server rejects the pre-template { formData } shape with 400.
  it('PUTs { templateVersion, responses, ... } without formData or patientId in the body', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ success: true, data: {} }) })
    const { result } = renderHook(() => useUpsertAnamnesis(), { wrapper: wrap() })

    await result.current.mutateAsync({
      patientId: 'p-1',
      templateVersion: 3,
      responses: { q1: 'Sim' },
      expectedUpdatedAt: '2026-10-12T10:00:00.000Z',
    })

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/anamnesis/p-1')
    expect(init.method).toBe('PUT')
    expect(JSON.parse(init.body)).toEqual({
      templateVersion: 3,
      responses: { q1: 'Sim' },
      expectedUpdatedAt: '2026-10-12T10:00:00.000Z',
    })
  })

  // Regression: the form decides between stale and template_changed reloads from status and code.
  it('rejects with AnamnesisSaveError carrying status and code on a 409', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 409,
      json: async () => ({ error: 'mudou', code: 'template_changed' }),
    })
    const { result } = renderHook(() => useUpsertAnamnesis(), { wrapper: wrap() })

    const error = await result.current
      .mutateAsync({ patientId: 'p-1', templateVersion: 1, responses: {} })
      .catch((e) => e)

    expect(error).toBeInstanceOf(AnamnesisSaveError)
    expect(error).toMatchObject({ message: 'mudou', status: 409, code: 'template_changed' })
  })
})
