import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { AnamnesisTemplateSettings } from '../anamnesis-template-settings'
import type { FormSection } from '@/lib/forms/types'

const mutateAsync = vi.fn()

const SAVED: FormSection[] = [{ id: 's1', title: 'Histórico', order: 0, questions: [] }]
const DEFAULT: FormSection[] = [{ id: 'd1', title: 'Padrão restaurado', order: 0, questions: [] }]

let template: { version: number; sections: FormSection[] }

vi.mock('@/hooks/queries/use-anamnesis', () => ({
  useAnamnesisTemplate: () => ({ data: template, isLoading: false, isError: false }),
}))
vi.mock('@/hooks/mutations/use-anamnesis-mutations', () => ({
  useSaveAnamnesisTemplate: () => ({ mutateAsync }),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

beforeEach(() => {
  vi.clearAllMocks()
  template = { version: 2, sections: SAVED }
})

function renameFirstSection(title: string) {
  fireEvent.click(screen.getByTitle('Clique para editar o título'))
  const input = screen.getByDisplayValue('Histórico')
  fireEvent.change(input, { target: { value: title } })
  fireEvent.keyDown(input, { key: 'Enter' })
}

describe('AnamnesisTemplateSettings', () => {
  it('sends the edited title, not the saved one (previously the save could post the stale template)', async () => {
    mutateAsync.mockResolvedValue({ success: true, data: { version: 3, sections: [] } })
    render(<AnamnesisTemplateSettings />)

    renameFirstSection('Saúde geral')
    fireEvent.click(screen.getByRole('button', { name: /Salvar/ }))

    await waitFor(() =>
      expect(mutateAsync).toHaveBeenCalledWith({
        action: 'update',
        sections: [{ ...SAVED[0], title: 'Saúde geral' }],
      }),
    )
  })

  // Regression: jsonb returns keys in its own order, so the JSON.stringify compare kept
  // "Alterações não salvas" after a successful save.
  it('clears the unsaved indicator when the refetched sections only differ in key order', async () => {
    mutateAsync.mockImplementation(async ({ sections }: { sections: FormSection[] }) => {
      template = {
        version: 3,
        sections: sections.map(({ id, title, order, questions }) => ({ questions, order, title, id })),
      }
      return { success: true, data: template }
    })
    const { rerender } = render(<AnamnesisTemplateSettings />)

    renameFirstSection('Saúde geral')
    expect(screen.getByText('Alterações não salvas')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Salvar/ }))
    await waitFor(() => expect(mutateAsync).toHaveBeenCalled())
    rerender(<AnamnesisTemplateSettings />)

    await waitFor(() => expect(screen.queryByText('Alterações não salvas')).toBeNull())
  })

  // Regression: reset response ignored, editor keeps stale sections
  it('shows the sections returned by the reset action', async () => {
    mutateAsync.mockResolvedValue({ success: true, data: { version: 0, sections: DEFAULT } })
    render(<AnamnesisTemplateSettings />)

    fireEvent.click(screen.getAllByRole('button', { name: /Restaurar padrão/ })[0])
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }))

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledWith({ action: 'reset' }))
    expect(await screen.findByText('Padrão restaurado')).toBeTruthy()
    expect(screen.queryByText('Histórico')).toBeNull()
  })
})
