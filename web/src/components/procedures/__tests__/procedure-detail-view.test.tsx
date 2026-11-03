import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithProviders } from '@/tests/test-utils'
import type { ProcedureWithDetails } from '@/db/queries/procedures'
import type { DiagramWithPoints } from '@/db/queries/face-diagrams'
import type { PendingConsentItem } from '@/db/queries/consent'
import type { DiagramPointData } from '@/components/face-diagram/types'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('@/hooks/queries/use-planejamentos', () => ({
  useFollowupsForProcedure: () => ({ data: undefined }),
}))
vi.mock('@/components/planejamentos/followup-modal', () => ({ FollowupModal: () => null }))
vi.mock('@/components/planejamentos/snooze-modal', () => ({ SnoozeModal: () => null }))
let renderedPoints: DiagramPointData[] = []
vi.mock('@/components/face-diagram/face-diagram-editor', () => ({
  FaceDiagramEditor: ({ points }: { points: DiagramPointData[] }) => {
    renderedPoints = points
    return null
  },
}))
let pending: PendingConsentItem[] = []
vi.mock('@/hooks/queries/use-consent', () => ({
  usePendingConsents: () => ({ data: pending }),
}))

import { ProcedureDetailView } from '../procedure-detail-view'

const procedure = {
  id: 'rec-1',
  patientId: 'pat-1',
  status: 'in_progress',
  procedureTypeName: 'Toxina',
  practitionerName: 'Dra. Flora',
  createdAt: '2026-10-01T12:00:00Z',
  approvedAt: '2026-10-02T12:00:00Z',
  performedAt: '2026-10-03T12:00:00Z',
  financialPlan: null,
} as unknown as ProcedureWithDetails

function point(id: string) {
  return {
    id,
    x: '10',
    y: '20',
    productName: 'Botox',
    activeIngredient: null,
    quantity: '2',
    quantityUnit: 'U',
    technique: null,
    depth: null,
    notes: null,
  }
}

function renderView(diagrams: DiagramWithPoints[] = []) {
  renderWithProviders(
    <ProcedureDetailView
      patientId="pat-1"
      patientName="Maria"
      procedure={procedure}
      diagrams={diagrams}
      applications={[]}
    />,
  )
}

beforeEach(() => {
  pending = []
  renderedPoints = []
  global.fetch = vi.fn(async () => new Response('[]', { status: 200 })) as unknown as typeof fetch
})

describe('ProcedureDetailView', () => {
  it('keeps each point on the face view it was placed on', () => {
    renderView([
      { id: 'd1', viewType: 'front', points: [point('a')] },
      { id: 'd2', viewType: 'left_profile', points: [point('b')] },
    ] as unknown as DiagramWithPoints[])

    expect(renderedPoints.map((p) => [p.id, p.viewType])).toEqual([
      ['a', 'front'],
      ['b', 'left_profile'],
    ])
  })

  it('points to signature collection while this procedure has pending signatures', () => {
    pending = [
      { procedureRecordId: 'other', procedureTypeName: 'X', approvedAt: null, pendingTypes: ['filler'] },
      { procedureRecordId: 'rec-1', procedureTypeName: 'Toxina', approvedAt: null, pendingTypes: ['botox', 'service_contract'] },
    ]
    renderView()

    expect(
      screen.getByText('Assinaturas pendentes: Toxina Botulínica, Contrato de Serviço'),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Coletar assinaturas' })).toHaveAttribute(
      'href',
      '/pacientes/pat-1/procedimentos/rec-1?action=sign',
    )
  })

  it('shows no signature notice when only other procedures are pending', () => {
    pending = [
      { procedureRecordId: 'other', procedureTypeName: 'X', approvedAt: null, pendingTypes: ['filler'] },
    ]
    renderView()

    expect(screen.queryByRole('link', { name: 'Coletar assinaturas' })).toBeNull()
  })
})
