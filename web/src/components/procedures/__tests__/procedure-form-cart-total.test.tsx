import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ProcedureForm } from '../procedure-form'
import { buildCartFromQuote } from '@/lib/diagram-quote'

const mockCreate = vi.fn(async () => ({ data: { id: 'created-proc-id' } }))

vi.mock('@/hooks/mutations/use-procedure-mutations', () => ({
  useCreateProcedure: () => ({ mutateAsync: mockCreate, isPending: false }),
  useUpdateProcedure: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))
vi.mock('@/hooks/mutations/use-evaluation-mutations', () => ({
  useSaveEvaluationResponse: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}))

const BOTOX = '550e8400-e29b-41d4-a716-446655440000'
const FILLER = '550e8400-e29b-41d4-a716-446655440001'

const catalogTypes = [
  { id: BOTOX, name: 'Botox', defaultPrice: '1000.00' },
  { id: FILLER, name: 'Preenchimento', defaultPrice: '2000.00' },
]

describe('ProcedureForm started from a quotation', () => {
  beforeEach(() => {
    mockCreate.mockClear()
    global.fetch = vi.fn(async (url: string) => {
      const body = String(url).startsWith('/api/procedure-types') ? catalogTypes : []
      return new Response(JSON.stringify(body), { status: 200 })
    }) as unknown as typeof fetch
  })

  it('bills the quoted prices, not the catalog prices, after procedure types load', async () => {
    const cart = buildCartFromQuote([
      { procedureTypeId: BOTOX, procedureTypeName: 'Botox', unitPrice: 750, sessions: 1 },
      { procedureTypeId: FILLER, procedureTypeName: 'Preenchimento', unitPrice: 1800.5, sessions: 2 },
    ])
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const overrides = {
      hideSaveButton: true,
      hideNavigation: true,
      hideTitle: true,
      hideProcedureTypes: true,
      onSaveComplete: vi.fn(),
    }
    const tree = (triggerSave: number) => (
      <QueryClientProvider client={qc}>
        <ProcedureForm
          patientId="patient-123"
          initialTypeIds={[BOTOX, FILLER]}
          mode="create"
          cart={cart}
          wizardOverrides={{ ...overrides, triggerSave }}
        />
      </QueryClientProvider>
    )
    const { rerender } = render(tree(0))
    await vi.waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith('/api/procedure-types'),
    )
    await act(async () => {
      await vi.mocked(global.fetch).mock.results[0].value
    })
    rerender(tree(1))

    await vi.waitFor(() => expect(mockCreate).toHaveBeenCalled(), { timeout: 3000 })

    const payload = (mockCreate.mock.calls[0] as unknown as [{ financialPlan: { totalAmount: number } }])[0]
    expect(payload.financialPlan.totalAmount).toBe(4351)
  })
})
