import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, fireEvent, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@/tests/test-utils'

// ─── Mocks ─────────────────────────────────────────────────────────
//
// We mock the data hooks so the tab renders deterministically without
// hitting the network. Each test overrides `useEvolutions` via the
// helper below to control the feed contents.
//
// `useCreateEvolution` / `useEditEvolution` / `useDeleteEvolution` /
// `useEvolutionRevisions` are mocked as no-op shells; the tab and the
// composer/drawer only need them to exist with the right shape.

const useEvolutionsMock = vi.fn()
const useEvolutionRevisionsMock = vi.fn()

vi.mock('@/hooks/queries/use-evolutions', () => ({
  useEvolutions: (...args: unknown[]) => useEvolutionsMock(...args),
  useEvolutionRevisions: (...args: unknown[]) => useEvolutionRevisionsMock(...args),
  evolutionsKeys: {
    feed: (patientId: string) => ['patients', patientId, 'evolutions'] as const,
    revisions: (patientId: string, noteId: string) =>
      ['patients', patientId, 'evolutions', noteId, 'revisions'] as const,
  },
}))

vi.mock('@/hooks/mutations/use-evolution-mutations', () => ({
  useCreateEvolution: () => ({
    mutate: vi.fn(),
    mutateAsync: vi.fn().mockResolvedValue({ note: {} }),
    isPending: false,
    isError: false,
    error: null,
    reset: vi.fn(),
  }),
  useEditEvolution: () => ({
    mutate: vi.fn(),
    mutateAsync: vi.fn().mockResolvedValue({ note: {} }),
    isPending: false,
    isError: false,
    error: null,
    reset: vi.fn(),
  }),
  useDeleteEvolution: () => ({
    mutate: vi.fn(),
    mutateAsync: vi.fn().mockResolvedValue(undefined),
    isPending: false,
    isError: false,
    error: null,
    reset: vi.fn(),
  }),
}))

// Import AFTER vi.mock declarations so the mocked modules are used.
import { PatientEvolutionsTab } from '../patient-evolutions-tab'

// ─── Fixtures ──────────────────────────────────────────────────────

const PATIENT_ID = 'patient-1'

function makeNoteEntry(overrides: Record<string, unknown> = {}) {
  return {
    kind: 'note' as const,
    id: 'note-1',
    tenantId: 'tenant-1',
    patientId: PATIENT_ID,
    body: 'Paciente relatou melhora significativa após a sessão.',
    authorId: 'user-1',
    authorName: 'Dra. Ana',
    occurredAt: new Date('2026-05-25T14:00:00.000Z'),
    createdAt: new Date('2026-05-25T14:00:00.000Z'),
    updatedAt: new Date('2026-05-25T14:00:00.000Z'),
    deletedAt: null,
    deletedBy: null,
    deleteReason: null,
    revisionCount: 0,
    ...overrides,
  }
}

function makeSessionEntry(overrides: Record<string, unknown> = {}) {
  return {
    kind: 'session' as const,
    id: 'session-1',
    occurredAt: new Date('2026-05-20T12:00:00.000Z'),
    executedById: 'user-1',
    executedByName: 'Dra. Ana',
    procedureRecordId: 'record-1',
    procedureTypeName: 'Aplicação de Toxina',
    sessionOrdinal: 1,
    sessionsTotal: 1,
    recordStatus: 'completed',
    technique: 'Aplicação em pontos da glabela',
    clinicalResponse: null,
    adverseEffects: null,
    notes: null,
    followUpDate: null,
    nextSessionObjectives: null,
    productApplications: [],
    diagramPointCount: 0,
    ...overrides,
  }
}

function mockFeed(entries: unknown[], overrides: Record<string, unknown> = {}) {
  useEvolutionsMock.mockReturnValue({
    data: entries,
    isPending: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
    ...overrides,
  })
}

beforeEach(() => {
  useEvolutionsMock.mockReset()
  useEvolutionRevisionsMock.mockReset()
  useEvolutionRevisionsMock.mockReturnValue({
    data: [],
    isPending: false,
    isError: false,
    error: null,
  })
})

// ─── Tests ─────────────────────────────────────────────────────────

describe('PatientEvolutionsTab', () => {
  it('renders empty state when feed is empty', () => {
    mockFeed([])
    renderWithProviders(
      <PatientEvolutionsTab patientId={PATIENT_ID} canEdit={true} />,
    )

    expect(
      screen.getByText('Nenhuma evolução registrada ainda.'),
    ).toBeInTheDocument()
  })

  it('renders entries when feed has items', () => {
    mockFeed([
      makeNoteEntry({
        body: 'Paciente ligou relatando febre baixa.',
      }),
      makeSessionEntry({
        technique: 'Aplicação em pontos da glabela',
      }),
    ])

    renderWithProviders(
      <PatientEvolutionsTab patientId={PATIENT_ID} canEdit={true} />,
    )

    expect(
      screen.getByText(/Paciente ligou relatando febre baixa\./),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/Aplicação em pontos da glabela/),
    ).toBeInTheDocument()
  })

  it('hides Nova evolução button when canEdit=false', () => {
    mockFeed([])
    renderWithProviders(
      <PatientEvolutionsTab patientId={PATIENT_ID} canEdit={false} />,
    )

    expect(
      screen.queryByRole('button', { name: /nova evolução/i }),
    ).not.toBeInTheDocument()
  })

  it('shows Nova evolução button when canEdit=true', () => {
    mockFeed([])
    renderWithProviders(
      <PatientEvolutionsTab patientId={PATIENT_ID} canEdit={true} />,
    )

    expect(
      screen.getByRole('button', { name: /nova evolução/i }),
    ).toBeInTheDocument()
  })

  it('opens composer when Nova evolução clicked', async () => {
    mockFeed([])
    renderWithProviders(
      <PatientEvolutionsTab patientId={PATIENT_ID} canEdit={true} />,
    )

    const button = screen.getByRole('button', { name: /nova evolução/i })
    fireEvent.click(button)

    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: /nova evolução/i }),
      ).toBeInTheDocument()
    })
  })

  it('renders Imprimir link with correct href', () => {
    mockFeed([])
    renderWithProviders(
      <PatientEvolutionsTab patientId={PATIENT_ID} canEdit={true} />,
    )

    const link = screen.getByRole('link', { name: /imprimir/i })
    expect(link).toBeInTheDocument()
    expect(link).toHaveAttribute(
      'href',
      `/pacientes/${PATIENT_ID}/evolucoes/imprimir`,
    )
  })
})
