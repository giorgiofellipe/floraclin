import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { EvaluationTemplatePageClient } from '../evaluation-template-page-client'

const mocks = vi.hoisted(() => ({
  useProcedureTypes: vi.fn(),
  useEvaluationTemplates: vi.fn(),
}))

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('@/hooks/queries/use-procedure-types', () => ({ useProcedureTypes: mocks.useProcedureTypes }))
vi.mock('@/hooks/queries/use-evaluation', () => ({ useEvaluationTemplates: mocks.useEvaluationTemplates }))
vi.mock('@/hooks/mutations/use-evaluation-mutations', () => ({
  useSaveEvaluationTemplate: () => ({ mutateAsync: vi.fn() }),
}))

function renderForCategory(category: string) {
  mocks.useProcedureTypes.mockReturnValue({
    data: [{ id: 'pt-1', name: 'Procedimento', category }],
    isLoading: false,
  })
  mocks.useEvaluationTemplates.mockReturnValue({ data: [], isLoading: false })
  render(<EvaluationTemplatePageClient procedureTypeId="pt-1" defaultCategories={['botox', 'filler']} />)
}

describe('EvaluationTemplatePageClient', () => {
  it('hides "Restaurar padrão" for a category without a default template', () => {
    renderForCategory('outros')

    expect(screen.queryByRole('button', { name: 'Restaurar padrão' })).not.toBeInTheDocument()
  })

  it('shows "Restaurar padrão" for a category with a default template', () => {
    renderForCategory('botox')

    expect(screen.getByRole('button', { name: 'Restaurar padrão' })).toBeInTheDocument()
  })
})
