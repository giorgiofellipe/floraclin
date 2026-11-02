import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithProviders } from '@/tests/test-utils'
import type { DiagramGroupDetail } from '@/db/queries/face-diagram-groups'
import type { Patient } from '@/db/queries/patients'

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))
vi.mock('@/components/face-diagram/face-diagram-editor', () => ({
  FaceDiagramEditor: ({ readOnly }: { readOnly?: boolean }) => (
    <div data-testid="diagram" data-readonly={String(!!readOnly)} />
  ),
}))
vi.mock('../quotation-lines-editor', () => ({ QuotationLinesEditor: () => <div /> }))
vi.mock('../quote-history', () => ({ QuoteHistory: () => <div data-testid="history" /> }))
vi.mock('@/hooks/queries/use-products', () => ({ useDiagramProducts: () => ({ data: [] }) }))
let procedures: { status: string }[] = []
vi.mock('@/hooks/queries/use-procedures', () => ({
  useProcedures: () => ({ data: procedures }),
}))
vi.mock('@/hooks/mutations/use-face-diagram-group-mutations', () => ({
  useCreateDiagramGroup: () => ({ isPending: false, mutateAsync: vi.fn() }),
  useUpdateDiagramGroup: () => ({ isPending: false, mutateAsync: vi.fn() }),
}))

import { DiagramGroupEditor } from '../diagram-group-editor'

const patient = {
  id: 'pat-1',
  fullName: 'Maria da Silva',
  phone: '(11) 98765-4321',
  gender: 'female',
} as Patient

function makeGroup(overrides: Partial<DiagramGroupDetail> = {}): DiagramGroupDetail {
  return {
    id: 'grp-1',
    patientId: 'pat-1',
    status: 'quote',
    quotationLines: [
      { procedureTypeId: 't', procedureTypeName: 'Toxina', sessions: 1, unitPrice: 100 },
    ],
    quotationTotal: 100,
    views: [],
    ...overrides,
  } as unknown as DiagramGroupDetail
}

beforeEach(() => {
  procedures = []
})

describe('DiagramGroupEditor', () => {
  it('is read-only without write actions once the diagram is in an atendimento', () => {
    renderWithProviders(
      <DiagramGroupEditor patient={patient} group={makeGroup({ status: 'in_service' })} role="owner" />,
    )
    expect(screen.getByTestId('diagram').dataset.readonly).toBe('true')
    expect(screen.queryByRole('button', { name: 'Salvar' })).toBeNull()
    expect(screen.queryByRole('link', { name: /Iniciar atendimento/ })).toBeNull()
  })

  it('is read-only for a receptionist even on a quote, but keeps the history', () => {
    renderWithProviders(
      <DiagramGroupEditor patient={patient} group={makeGroup()} role="receptionist" />,
    )
    expect(screen.getByTestId('diagram').dataset.readonly).toBe('true')
    expect(screen.queryByRole('button', { name: 'Salvar' })).toBeNull()
    expect(screen.queryByRole('button', { name: /Gerar PDF/ })).toBeNull()
    expect(screen.getByTestId('history')).toBeTruthy()
  })

  it('offers to continue the open atendimento without attaching the diagram', () => {
    procedures = [{ status: 'in_progress' }]
    renderWithProviders(
      <DiagramGroupEditor patient={patient} group={makeGroup()} role="owner" />,
    )
    const link = screen.getByRole('link', { name: 'Continuar atendimento' })
    expect(link.getAttribute('href')).toBe('/pacientes/pat-1/atendimento')
  })

  it('starts an atendimento with the diagram when none is open', () => {
    renderWithProviders(
      <DiagramGroupEditor patient={patient} group={makeGroup()} role="owner" />,
    )
    expect(
      screen.getByRole('link', { name: /Iniciar atendimento com este diagrama/ }).getAttribute('href'),
    ).toBe('/pacientes/pat-1/atendimento?new=1&diagram=grp-1')
  })

  it('disables Gerar PDF when the quotation has no lines', () => {
    renderWithProviders(
      <DiagramGroupEditor patient={patient} group={makeGroup({ quotationLines: [] })} role="owner" />,
    )
    expect(
      (screen.getByRole('button', { name: /Gerar PDF/ }) as HTMLButtonElement).disabled,
    ).toBe(true)
  })
})
