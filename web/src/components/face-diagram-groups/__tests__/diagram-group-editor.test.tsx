import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { toast } from 'sonner'
import { renderWithProviders } from '@/tests/test-utils'
import type { DiagramGroupJson } from '@/hooks/queries/use-face-diagram-groups'
import type { Patient } from '@/db/queries/patients'

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))
vi.mock('@/components/face-diagram/face-diagram-editor', () => ({
  FaceDiagramEditor: ({ readOnly }: { readOnly?: boolean }) => (
    <div data-testid="diagram" data-readonly={String(!!readOnly)} />
  ),
}))
vi.mock('../quotation-lines-editor', () => ({ QuotationLinesEditor: () => <div data-testid="lines" /> }))
vi.mock('../quote-history', () => ({ QuoteHistory: () => <div data-testid="history" /> }))
vi.mock('@/hooks/queries/use-products', () => ({ useDiagramProducts: () => ({ data: [] }) }))
let procedures: { status: string }[] | undefined = []
vi.mock('@/hooks/queries/use-procedures', () => ({
  useProcedures: () => ({ data: procedures, isLoading: procedures === undefined }),
}))
vi.mock('@/hooks/mutations/use-face-diagram-group-mutations', async (importOriginal) => ({
  ...(await importOriginal<object>()),
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

function makeGroup(overrides: Partial<DiagramGroupJson> = {}): DiagramGroupJson {
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
  } as unknown as DiagramGroupJson
}

beforeEach(() => {
  procedures = []
  vi.clearAllMocks()
})

afterEach(() => vi.unstubAllGlobals())

describe('DiagramGroupEditor', () => {
  it('is read-only without write actions once the diagram is in an atendimento', () => {
    renderWithProviders(
      <DiagramGroupEditor patient={patient} group={makeGroup({ status: 'in_service' })} role="owner" />,
    )
    expect(screen.getByTestId('diagram').dataset.readonly).toBe('true')
    expect(screen.queryByRole('button', { name: 'Salvar' })).toBeNull()
    expect(screen.queryByRole('link', { name: /Iniciar atendimento/ })).toBeNull()
    expect(
      screen.getByRole('link', { name: 'Continuar atendimento' }).getAttribute('href'),
    ).toBe('/pacientes/pat-1/atendimento')
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

  it('does not offer a new atendimento while the open ones are still loading', () => {
    procedures = undefined
    renderWithProviders(
      <DiagramGroupEditor patient={patient} group={makeGroup()} role="owner" />,
    )
    expect(screen.queryByRole('link', { name: /atendimento/ })).toBeNull()
    expect(
      (screen.getByRole('button', { name: /atendimento/ }) as HTMLButtonElement).disabled,
    ).toBe(true)
  })

  it('hides the orçamento fields and actions until the user turns the diagram into one', () => {
    renderWithProviders(
      <DiagramGroupEditor
        patient={patient}
        group={makeGroup({ status: 'diagram', quotationLines: [] })}
        role="owner"
      />,
    )
    expect(screen.queryByTestId('lines')).toBeNull()
    expect(screen.queryByRole('button', { name: /Gerar PDF/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Enviar por WhatsApp/ })).toBeNull()

    fireEvent.click(screen.getByRole('switch', { name: 'Transformar em orçamento?' }))

    expect(screen.getByTestId('lines')).toBeTruthy()
    expect(
      (screen.getByRole('button', { name: /Gerar PDF/ }) as HTMLButtonElement).disabled,
    ).toBe(true)
  })

  it('opens an existing orçamento with its fields shown', () => {
    renderWithProviders(<DiagramGroupEditor patient={patient} group={makeGroup()} role="owner" />)
    expect(screen.getByRole('switch', { name: 'Transformar em orçamento?' })).toBeChecked()
    expect(screen.getByTestId('lines')).toBeTruthy()
  })

  it('asks before dropping the lines of an orçamento, and keeps them on cancel', async () => {
    renderWithProviders(<DiagramGroupEditor patient={patient} group={makeGroup()} role="owner" />)
    const toggle = screen.getByRole('switch', { name: 'Transformar em orçamento?' })

    fireEvent.click(toggle)
    fireEvent.click(await screen.findByRole('button', { name: 'Manter orçamento' }))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Remover' })).toBeNull())
    expect(screen.getByTestId('lines')).toBeTruthy()

    fireEvent.click(toggle)
    fireEvent.click(await screen.findByRole('button', { name: 'Remover' }))
    await waitFor(() => expect(screen.queryByTestId('lines')).toBeNull())
    expect(screen.queryByRole('button', { name: /Gerar PDF/ })).toBeNull()
  })

  it('closes the PDF tab and explains the failure when the network is down', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    const tab = { close: vi.fn(), location: {} }
    vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window)
    renderWithProviders(<DiagramGroupEditor patient={patient} group={makeGroup()} role="owner" />)

    fireEvent.click(screen.getByRole('button', { name: /Gerar PDF/ }))

    await waitFor(() => expect(tab.close).toHaveBeenCalled())
    expect(toast.error).toHaveBeenCalledWith(
      'Falha ao gerar orçamento. Verifique sua conexão e tente novamente.',
    )
    expect(screen.getByRole('button', { name: /Gerar PDF/ })).toBeEnabled()
  })

  it('explains a WhatsApp send that fails on the network', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('send-whatsapp')) throw new TypeError('Failed to fetch')
        return new Response(JSON.stringify({ data: { id: 'q1', url: '/q1.pdf' } }), { status: 200 })
      }),
    )
    renderWithProviders(<DiagramGroupEditor patient={patient} group={makeGroup()} role="owner" />)

    fireEvent.click(screen.getByRole('button', { name: /Enviar por WhatsApp/ }))

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        'Falha ao enviar via WhatsApp. Verifique sua conexão e tente novamente.',
      ),
    )
    expect(screen.getByRole('button', { name: /Enviar por WhatsApp/ })).toBeEnabled()
  })
})
