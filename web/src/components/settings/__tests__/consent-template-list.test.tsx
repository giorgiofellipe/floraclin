import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ConsentTemplateList } from '../consent-template-list'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries: vi.fn() }) }))
vi.mock('@/hooks/mutations/use-consent-mutations', () => ({
  useCreateConsentTemplate: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateConsentTemplate: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))

const GENERAL_V1 = {
  id: 't-1',
  type: 'general',
  title: 'Consentimento Geral',
  content: 'Texto',
  version: 1,
  isActive: true,
  createdAt: new Date('2026-01-01T12:00:00Z'),
  updatedAt: new Date('2026-01-01T12:00:00Z'),
}

describe('ConsentTemplateList "Novo"', () => {
  // Regression FLORACLIN-1H: "Novo" defaults to the already-seeded "general" type and
  // presented the save as a brand-new term ("Criar termo") instead of a new version.
  it('tells the owner that saving an existing type creates the next version', () => {
    render(<ConsentTemplateList templates={[GENERAL_V1]} />)

    fireEvent.click(screen.getByRole('button', { name: /Novo/ }))

    screen.getByText(/Já existe um termo deste tipo/)
    screen.getByRole('button', { name: 'Salvar nova versão (v2)' })
  })

  it('offers to create the term when the tenant has no active template of the default type', () => {
    render(<ConsentTemplateList templates={[{ ...GENERAL_V1, id: 't-2', type: 'botox' }]} />)

    fireEvent.click(screen.getByRole('button', { name: /Novo/ }))

    screen.getByRole('button', { name: 'Criar termo' })
    expect(screen.queryByText(/Já existe um termo deste tipo/)).toBeNull()
  })
})
