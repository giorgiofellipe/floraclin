import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QuestionEditorDialog } from '../question-editor-dialog'
import { BASE_QUESTION_TYPES } from '@/lib/forms/types'
import type { FormQuestion } from '@/lib/forms/types'

const listQuestion: FormQuestion = {
  id: 'q1',
  label: 'Medicamentos',
  type: 'list',
  required: false,
  order: 0,
  columns: [
    { id: 'c1', label: 'Nome', kind: 'text' },
    { id: 'c2', label: 'Dose', kind: 'text' },
  ],
}

describe('QuestionEditorDialog', () => {
  it('does not offer the face diagram type when allowedTypes excludes it (regression: anamnesis editor offered a type it cannot render)', async () => {
    const user = userEvent.setup()
    render(
      <QuestionEditorDialog open onOpenChange={vi.fn()} allowedTypes={BASE_QUESTION_TYPES} onSave={vi.fn()} />,
    )

    await user.click(screen.getByRole('combobox'))

    expect(await screen.findByRole('option', { name: 'Lista' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Diagrama facial' })).toBeNull()
  })

  it('keeps Salvar disabled while a list column has no name (previously a list could be saved with an unnamed column)', async () => {
    const user = userEvent.setup()
    render(
      <QuestionEditorDialog
        open
        onOpenChange={vi.fn()}
        allowedTypes={BASE_QUESTION_TYPES}
        question={{ ...listQuestion, columns: [{ id: 'c1', label: '', kind: 'text' }] }}
        onSave={vi.fn()}
      />,
    )

    const save = screen.getByRole('button', { name: 'Salvar' })
    expect(save).toBeDisabled()

    await user.type(screen.getByLabelText('Nome da coluna'), 'Nome')
    expect(save).toBeEnabled()
  })

  it('says why Salvar is disabled (previously the button stayed disabled with no reason shown)', async () => {
    const user = userEvent.setup()
    render(
      <QuestionEditorDialog
        open
        onOpenChange={vi.fn()}
        allowedTypes={BASE_QUESTION_TYPES}
        question={{ ...listQuestion, columns: [] }}
        onSave={vi.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: 'Salvar' })).toBeDisabled()
    expect(screen.getByRole('alert')).toHaveTextContent('"Medicamentos" precisa de ao menos 1 coluna')

    await user.click(screen.getByRole('button', { name: /Adicionar coluna/ }))
    await user.type(screen.getByLabelText('Nome da coluna'), 'Nome')
    expect(screen.getByRole('button', { name: 'Salvar' })).toBeEnabled()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('saves columns in the reordered order (regression: column reorder lost)', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    render(
      <QuestionEditorDialog
        open
        onOpenChange={vi.fn()}
        allowedTypes={BASE_QUESTION_TYPES}
        question={listQuestion}
        onSave={onSave}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Mover coluna Nome para baixo' }))
    await user.click(screen.getByRole('button', { name: 'Salvar' }))

    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onSave.mock.calls[0][0].columns.map((c: { id: string }) => c.id)).toEqual(['c2', 'c1'])
  })
})
