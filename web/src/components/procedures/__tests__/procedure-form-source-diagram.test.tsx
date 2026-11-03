import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { DiagramPointRecord, DiagramWithPoints } from '@/db/queries/face-diagrams'
import { ProcedureForm } from '../procedure-form'

const mockCreate = vi.fn(async () => ({ data: { id: 'created-proc-id' } }))
const mockUpdate = vi.fn(async () => ({ data: { id: 'proc-1' } }))

vi.mock('@/hooks/mutations/use-procedure-mutations', () => ({
  useCreateProcedure: () => ({ mutateAsync: mockCreate, isPending: false }),
  useUpdateProcedure: () => ({ mutateAsync: mockUpdate, isPending: false }),
}))
vi.mock('@/components/face-diagram/face-diagram-editor', () => ({
  FaceDiagramEditor: ({
    points,
    onChange,
  }: {
    points: { viewType?: string }[]
    onChange: (next: unknown[]) => void
  }) => (
    <button type="button" onClick={() => onChange(points.filter((p) => p.viewType !== 'left_profile'))}>
      limpar perfil esquerdo
    </button>
  ),
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
    mockUpdate.mockClear()
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

  it('sends an emptied view so the server clears it', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const overrides = {
      hideSaveButton: true,
      hideNavigation: true,
      hideTitle: true,
      hideProcedureTypes: true,
      onSaveComplete: vi.fn(),
    }
    const procedure = {
      id: 'proc-1',
      patientId: 'patient-123',
      procedureTypeId: '550e8400-e29b-41d4-a716-446655440000',
      additionalTypeIds: [],
      status: 'planned',
      financialPlan: null,
    } as never
    const diagramTemplate = {
      id: 'tpl-1',
      procedureTypeId: '550e8400-e29b-41d4-a716-446655440000',
      procedureTypeName: 'Botox',
      version: 1,
      sections: [
        { id: 's1', title: 'Diagrama', questions: [{ id: 'q1', type: 'face_diagram', label: 'Pontos' }] },
      ],
    } as never
    const tree = (triggerSave: number) => (
      <QueryClientProvider client={qc}>
        <ProcedureForm
          patientId="patient-123"
          procedure={procedure}
          diagrams={sourceDiagram.views}
          evaluationTemplates={[diagramTemplate]}
          mode="edit"
          wizardOverrides={{ ...overrides, triggerSave }}
        />
      </QueryClientProvider>
    )
    const { rerender } = render(tree(0))
    fireEvent.click(await screen.findByRole('button', { name: 'limpar perfil esquerdo' }))
    rerender(tree(1))

    await vi.waitFor(() => expect(mockUpdate).toHaveBeenCalled(), { timeout: 3000 })

    const payload = (mockUpdate.mock.calls[0] as unknown as [Record<string, unknown>])[0]
    expect(payload.diagrams).toContainEqual({ viewType: 'left_profile', points: [] })
  })
})
