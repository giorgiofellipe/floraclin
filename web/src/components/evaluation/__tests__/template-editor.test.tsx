import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TemplateEditor } from '../template-editor'
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
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const sourceSections: EvaluationSection[] = [
  {
    id: 'src-s1',
    title: 'Histórico do Botox',
    order: 0,
    questions: [
      { id: 'src-q1', label: 'Alergias', type: 'text', required: false, order: 0 },
    ],
  },
]

function renderEditor(props: { hasDefaultTemplate?: boolean } = {}) {
  const onSave = vi.fn<(sections: EvaluationSection[]) => Promise<{ success: boolean }>>()
  onSave.mockResolvedValue({ success: true })
  render(
    <TemplateEditor
      procedureTypeName="Peeling"
      procedureTypeId="current"
      hasDefaultTemplate={props.hasDefaultTemplate ?? true}
      initialSections={[]}
      onSave={onSave}
      onResetToDefault={vi.fn()}
      onBack={vi.fn()}
    />,
  )
  return { onSave }
}

describe('TemplateEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.useProcedureTypes.mockReturnValue({
      data: [
        { id: 'current', name: 'Peeling' },
        { id: 'botox', name: 'Botox' },
      ],
      isLoading: false,
      isError: false,
    })
    mocks.useEvaluationTemplates.mockReturnValue({
      data: [{ id: 't1', procedureTypeId: 'botox', sections: sourceSections }],
      isLoading: false,
      isError: false,
    })
  })

  it('copies a ficha into the editor and saves it only on "Salvar"', async () => {
    const user = userEvent.setup()
    const { onSave } = renderEditor()

    await user.click(screen.getByRole('button', { name: 'Copiar de outro procedimento' }))
    await user.click(await screen.findByText('Botox'))
    await user.click(screen.getByRole('button', { name: 'Copiar' }))

    expect(screen.getByText(sourceSections[0].title)).toBeInTheDocument()
    expect(screen.getByText('Alterações não salvas')).toBeInTheDocument()
    expect(onSave).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Salvar' }))

    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onSave).toHaveBeenCalledWith(sourceSections)
  })
})
