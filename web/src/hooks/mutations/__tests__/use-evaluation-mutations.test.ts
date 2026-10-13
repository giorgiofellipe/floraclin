/**
 * The template editor decides between create and update from the cached
 * template. If saving resolves before that cache refetches, a second Salvar
 * on a new ficha posts another create and hits the unique index.
 */
import { describe, it, expect, vi } from 'vitest'
import { createElement, type ReactNode } from 'react'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import { useSaveEvaluationTemplate } from '../use-evaluation-mutations'
import { queryKeys } from '../../queries/query-keys'

const fetchMock = vi.fn()
global.fetch = fetchMock as unknown as typeof fetch

describe('useSaveEvaluationTemplate', () => {
  it('resolves only after the evaluation templates refetch', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ success: true }) })
    let finishRefetch!: (value: string) => void
    const templatesQueryFn = vi
      .fn<() => Promise<string>>()
      .mockResolvedValueOnce('before save')
      .mockImplementationOnce(() => new Promise((resolve) => { finishRefetch = resolve }))

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: qc }, children)
    const { result } = renderHook(
      () => ({
        templates: useQuery({ queryKey: queryKeys.evaluation.templates(['pt-1']), queryFn: templatesQueryFn }),
        save: useSaveEvaluationTemplate(),
      }),
      { wrapper },
    )
    await waitFor(() => expect(result.current.templates.data).toBe('before save'))

    const saved = vi.fn()
    const saving = result.current.save.mutateAsync({ action: 'create' }).then(saved)
    await waitFor(() => expect(templatesQueryFn).toHaveBeenCalledTimes(2))

    expect(saved).not.toHaveBeenCalled()
    finishRefetch('after save')
    await saving
    expect(qc.getQueryData(queryKeys.evaluation.templates(['pt-1']))).toBe('after save')
  })
})
