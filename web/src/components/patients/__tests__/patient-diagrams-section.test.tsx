import { describe, it, expect, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import { renderWithProviders } from '@/tests/test-utils'
import type { DiagramGroupDetail } from '@/db/queries/face-diagram-groups'

vi.mock('@/components/face-diagram/face-diagram-editor', () => ({
  FaceDiagramEditor: () => <div />,
}))
let groups: Partial<DiagramGroupDetail>[] = []
vi.mock('@/hooks/queries/use-face-diagram-groups', () => ({
  usePatientDiagramGroups: () => ({ data: groups, isLoading: false }),
}))

import { PatientDiagramsSection } from '../patient-diagrams-section'

const base = {
  patientId: 'pat-1',
  practitionerName: 'Dra. Ana',
  views: [],
  quotationLines: [],
  quotationTotal: null,
  procedureTypeName: 'Toxina',
  procedurePerformedAt: null,
  sessionOrdinal: null,
  procedureSessionId: null,
}

describe('PatientDiagramsSection', () => {
  it('nests a session group under its planning group', () => {
    groups = [
      { ...base, id: 'plan', procedureRecordId: 'proc-1', status: 'applied', quotationTotal: 500, createdAt: '2026-10-12T15:00:00Z' as unknown as Date },
      { ...base, id: 'sess', procedureRecordId: 'proc-1', procedureSessionId: 's1', sessionOrdinal: 1, status: 'applied', createdAt: '2026-10-13T15:00:00Z' as unknown as Date },
    ]
    renderWithProviders(<PatientDiagramsSection patientId="pat-1" role="owner" />)
    const items = screen.getAllByRole('listitem')
    expect(items).toHaveLength(1)
    expect(within(items[0]).getByText('Sessão 1')).toBeTruthy()
    expect(within(items[0]).getByText(/R\$\s*500,00/)).toBeTruthy()
  })

  it('shows a session-only procedure under an Atendimento heading', () => {
    groups = [
      { ...base, id: 'sess', procedureRecordId: 'proc-9', procedureSessionId: 's1', sessionOrdinal: 1, status: 'applied', procedurePerformedAt: '2026-10-20T15:00:00Z' as unknown as Date, createdAt: '2026-10-20T15:00:00Z' as unknown as Date },
    ]
    renderWithProviders(<PatientDiagramsSection patientId="pat-1" role="owner" />)
    expect(screen.getByText('Atendimento 20/10/2026 · Toxina')).toBeTruthy()
    expect(screen.getByText('Sessão 1')).toBeTruthy()
  })

  it('shows the empty state and hides Novo diagrama for a receptionist', () => {
    groups = []
    renderWithProviders(<PatientDiagramsSection patientId="pat-1" role="receptionist" />)
    expect(screen.getByText('Nenhum diagrama facial ainda')).toBeTruthy()
    expect(screen.queryByRole('link', { name: /Novo diagrama/ })).toBeNull()
  })
})
