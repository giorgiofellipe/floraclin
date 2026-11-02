import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { DiagramPointRecord, DiagramWithPoints } from '@/db/queries/face-diagrams'
import { ProcedureForm } from '../procedure-form'

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

function point(id: string, x: number): DiagramPointRecord {
  return {
    id,
    x: String(x),
    y: '40',
    productName: 'Botox',
    activeIngredient: null,
    quantity: '2',
    quantityUnit: 'U',
    technique: null,
    depth: null,
    notes: null,
    sortOrder: 0,
  }
}

const sourceDiagram: { groupId: string; views: DiagramWithPoints[] } = {
  groupId: 'group-1',
  views: [
    { id: 'd1', viewType: 'front', points: [point('a', 10)] },
    { id: 'd2', viewType: 'left_profile', points: [point('b', 20)] },
    { id: 'd3', viewType: 'right_profile', points: [point('c', 30)] },
  ],
}

describe('ProcedureForm with a source quotation diagram', () => {
  beforeEach(() => {
    mockCreate.mockClear()
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify([]), { status: 200 }),
    ) as unknown as typeof fetch
  })

  it('saves one diagram entry per view and links the group', async () => {
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
          initialTypeIds={['550e8400-e29b-41d4-a716-446655440000']}
          mode="create"
          sourceDiagram={sourceDiagram}
          wizardOverrides={{ ...overrides, triggerSave }}
        />
      </QueryClientProvider>
    )
    const { rerender } = render(tree(0))
    rerender(tree(1))

    await vi.waitFor(() => expect(mockCreate).toHaveBeenCalled(), { timeout: 3000 })

    const payload = (mockCreate.mock.calls[0] as unknown as [Record<string, unknown>])[0]
    expect(payload.diagramGroupId).toBe('group-1')
    const diagrams = payload.diagrams as { viewType: string; points: { x: number }[] }[]
    expect(diagrams.map((d) => [d.viewType, d.points.map((p) => p.x)])).toEqual([
      ['front', [10]],
      ['left_profile', [20]],
      ['right_profile', [30]],
    ])
  })
})
