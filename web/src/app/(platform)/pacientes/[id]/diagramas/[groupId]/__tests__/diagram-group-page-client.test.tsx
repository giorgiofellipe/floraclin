import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, renderWithProviders, screen, waitFor } from '@/tests/test-utils'

vi.mock('next/navigation', () => ({
  notFound: () => null,
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))
vi.mock('@/components/face-diagram/face-diagram-editor', () => ({
  FaceDiagramEditor: () => <div />,
}))
vi.mock('@/components/face-diagram-groups/quotation-lines-editor', () => ({
  QuotationLinesEditor: ({
    value,
    onChange,
  }: {
    value: { procedureTypeName: string }[]
    onChange: (next: unknown[]) => void
  }) => (
    <div>
      <p>linhas: {value.map((l) => l.procedureTypeName).join(', ')}</p>
      <button type="button" onClick={() => onChange([...value])}>
        editar linhas
      </button>
    </div>
  ),
}))
vi.mock('@/components/face-diagram-groups/quote-history', () => ({ QuoteHistory: () => null }))
vi.mock('@/hooks/queries/use-products', () => ({ useDiagramProducts: () => ({ data: [] }) }))
vi.mock('@/hooks/queries/use-procedures', () => ({
  useProcedures: () => ({ data: [], isLoading: false }),
}))
vi.mock('@/hooks/queries/use-patients', () => ({
  usePatient: () => ({
    data: { id: 'pat-1', fullName: 'Maria', phone: '(11) 98765-4321', gender: 'female' },
    isLoading: false,
  }),
}))

let group: Record<string, unknown>
vi.mock('@/hooks/queries/use-face-diagram-groups', () => ({
  useDiagramGroup: () => ({ data: group, isLoading: false }),
}))

const updateGroup = vi.fn()
const generateQuote = vi.fn()
vi.mock('@/hooks/mutations/use-face-diagram-group-mutations', () => ({
  useCreateDiagramGroup: () => ({ isPending: false, mutateAsync: vi.fn() }),
  useUpdateDiagramGroup: () => ({ isPending: false, mutateAsync: updateGroup }),
  useGenerateDiagramQuote: () => ({ mutateAsync: generateQuote }),
  useSendDiagramQuoteWhatsapp: () => ({ mutateAsync: vi.fn() }),
}))

import { DiagramGroupPageClient } from '../diagram-group-page-client'

function line(name: string) {
  return { procedureTypeId: 't', procedureTypeName: name, sessions: 1, unitPrice: 100 }
}

const page = () => <DiagramGroupPageClient patientId="pat-1" groupId="grp-1" role="owner" />

beforeEach(() => {
  vi.clearAllMocks()
  group = {
    id: 'grp-1',
    patientId: 'pat-1',
    status: 'quote',
    quotationLines: [line('Toxina')],
    views: [],
    updatedAt: '2026-11-03T10:00:00.000Z',
  }
  updateGroup.mockImplementation(async () => {
    group = { ...group, updatedAt: '2026-11-03T10:05:00.000Z' }
  })
  generateQuote.mockReturnValue(new Promise(() => {}))
  vi.spyOn(window, 'open').mockReturnValue({ close: vi.fn(), location: {} } as unknown as Window)
})

describe('DiagramGroupPageClient', () => {
  it.each([
    ['Gerar PDF', /Gerando/],
    ['Enviar por WhatsApp', /Enviando/],
  ])('keeps the send buttons disabled after %s saves the diagram', async (action, busyLabel) => {
    const { rerender } = renderWithProviders(page())
    fireEvent.click(screen.getByRole('button', { name: 'editar linhas' }))
    fireEvent.click(screen.getByRole('button', { name: action }))

    await waitFor(() => expect(generateQuote).toHaveBeenCalled())
    rerender(page())

    expect(screen.getByRole('button', { name: busyLabel })).toBeDisabled()
    for (const name of [/Gerar PDF|Gerando/, /WhatsApp|Enviando/]) {
      expect(screen.getByRole('button', { name })).toBeDisabled()
    }
  })

  it('shows the refetched quotation when the editor has no unsaved changes', () => {
    const { rerender } = renderWithProviders(page())
    group = { ...group, quotationLines: [line('Preenchimento')], updatedAt: '2026-11-03T11:00:00.000Z' }
    rerender(page())

    expect(screen.getByText('linhas: Preenchimento')).toBeInTheDocument()
  })
})
