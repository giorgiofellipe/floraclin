import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CopyTemplateDialog } from '../copy-template-dialog'
import type { EvaluationSection } from '@/types/evaluation'

const mocks = vi.hoisted(() => ({
  useProcedureTypes: vi.fn(),
  useEvaluationTemplates: vi.fn(),
}))

vi.mock('@/hooks/queries/use-procedure-types', () => ({
  useProcedureTypes: mocks.useProcedureTypes,
}))
vi.mock('@/hooks/queries/use-evaluation', () => ({
  useEvaluationTemplates: mocks.useEvaluationTemplates,
}))

function makeSections(title: string, questionCount: number): EvaluationSection[] {
  return [
    {
      id: `${title}-s1`,
      title,
      order: 0,
      questions: Array.from({ length: questionCount }, (_, i) => ({
        id: `${title}-q${i}`,
        label: `Pergunta ${i}`,
        type: 'text' as const,
        required: false,
        order: i,
      })),
    },
  ]
}

const types = [
  { id: 'current', name: 'Atual' },
  { id: 'botox', name: 'Botox' },
  { id: 'aaa', name: 'Preenchimento' },
  { id: 'empty', name: 'Vazio' },
  { id: 'none', name: 'Sem ficha' },
]

let botoxSections: EvaluationSection[]

function setup(overrides: { types?: unknown; templates?: unknown } = {}) {
  mocks.useProcedureTypes.mockReturnValue({
    data: types,
    isLoading: false,
    isError: false,
    ...(overrides.types as object),
  })
  mocks.useEvaluationTemplates.mockReturnValue({
    data: [
      { id: 't2', procedureTypeId: 'aaa', sections: makeSections('Preench', 1) },
      { id: 't1', procedureTypeId: 'botox', sections: botoxSections },
      { id: 't3', procedureTypeId: 'empty', sections: [] },
    ],
    isLoading: false,
    isError: false,
    ...(overrides.templates as object),
  })
  const onCopy = vi.fn()
  const onOpenChange = vi.fn()
  render(
    <CopyTemplateDialog
      open
      onOpenChange={onOpenChange}
      currentProcedureTypeId="current"
      onCopy={onCopy}
    />,
  )
  return { onCopy, onOpenChange }
}

describe('CopyTemplateDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    botoxSections = makeSections('Botox', 3)
  })

  it('lists only other procedures with a non-empty ficha', () => {
    setup()

    expect(mocks.useEvaluationTemplates).toHaveBeenCalledWith(['botox', 'aaa', 'empty', 'none'])
    expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'Botox3 perguntas',
      'Preenchimento1 pergunta',
    ])
    expect(screen.queryByText('Atual')).not.toBeInTheDocument()
    expect(screen.queryByText('Vazio')).not.toBeInTheDocument()
    expect(screen.queryByText('Sem ficha')).not.toBeInTheDocument()
  })

  it('copies a deep clone of the selected sections and closes', async () => {
    const user = userEvent.setup()
    const { onCopy, onOpenChange } = setup()

    await user.click(screen.getByText('Botox'))
    await user.click(screen.getByRole('button', { name: 'Copiar' }))

    expect(onCopy).toHaveBeenCalledTimes(1)
    const copied = onCopy.mock.calls[0][0] as EvaluationSection[]
    expect(copied).toEqual(makeSections('Botox', 3))
    copied[0].title = 'Mutado'
    copied[0].questions.pop()
    expect(botoxSections).toEqual(makeSections('Botox', 3))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('returns to the list on Cancelar without copying', async () => {
    const user = userEvent.setup()
    const { onCopy } = setup()

    await user.click(screen.getByText('Botox'))
    expect(screen.getByText(/Isso substitui as perguntas atuais/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Cancelar' }))

    expect(onCopy).not.toHaveBeenCalled()
    expect(screen.getByText('Preenchimento')).toBeInTheDocument()
    expect(screen.queryByText(/Isso substitui/)).not.toBeInTheDocument()
  })

  it('shows the empty state when no other procedure has a ficha', () => {
    setup({ templates: { data: [] } })

    expect(
      screen.getByText('Nenhum outro procedimento tem ficha de avaliação ainda.'),
    ).toBeInTheDocument()
  })

  it('shows the empty state, not loading, when the current type is the only one', () => {
    setup({
      types: { data: [{ id: 'current', name: 'Atual' }] },
      templates: { data: undefined, isLoading: false, isPending: true },
    })

    expect(
      screen.getByText('Nenhum outro procedimento tem ficha de avaliação ainda.'),
    ).toBeInTheDocument()
    expect(screen.queryByText('Carregando...')).not.toBeInTheDocument()
  })

  it('shows the error state when the templates query fails', () => {
    setup({ templates: { data: undefined, isError: true } })

    expect(
      screen.getByText('Erro ao carregar as fichas. Tente novamente.'),
    ).toBeInTheDocument()
  })

  it('shows loading while procedure types load', () => {
    setup({ types: { data: undefined, isLoading: true } })

    expect(screen.getByText('Carregando...')).toBeInTheDocument()
    expect(
      screen.queryByText('Nenhum outro procedimento tem ficha de avaliação ainda.'),
    ).not.toBeInTheDocument()
  })
})
