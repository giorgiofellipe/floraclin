import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { ConsentTemplateList } from '../consent-template-list'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries: vi.fn() }) }))
const restoreDefaults = vi.hoisted(() => vi.fn())
vi.mock('@/hooks/mutations/use-consent-mutations', () => ({
  useCreateConsentTemplate: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateConsentTemplate: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRestoreDefaultConsentTemplates: () => ({ mutateAsync: restoreDefaults, isPending: false }),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
// Native <select> stand-in so the test can switch the consent type
vi.mock('@/components/ui/select', () => ({
  Select: ({
    items,
    value,
    onValueChange,
  }: {
    items: Record<string, string>
    value: string
    onValueChange: (v: string) => void
  }) => (
    <select aria-label="Tipo" value={value} onChange={(e) => onValueChange(e.target.value)}>
      {Object.entries(items).map(([id, label]) => (
        <option key={id} value={id}>
          {label}
        </option>
      ))}
    </select>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: () => null,
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
    render(<ConsentTemplateList templates={[GENERAL_V1]} procedureTypes={[]} />)

    fireEvent.click(screen.getByRole('button', { name: /Novo/ }))

    screen.getByText(/Já existe um termo deste tipo/)
    screen.getByRole('button', { name: 'Salvar nova versão (v2)' })
  })

  it('offers to create the term when the tenant has no active template of the default type', () => {
    render(<ConsentTemplateList templates={[{ ...GENERAL_V1, id: 't-2', type: 'botox' }]} procedureTypes={[]} />)

    fireEvent.click(screen.getByRole('button', { name: /Novo/ }))

    screen.getByRole('button', { name: 'Criar termo' })
    expect(screen.queryByText(/Já existe um termo deste tipo/)).toBeNull()
  })
})

describe('ConsentTemplateList "Novo" prefill', () => {
  const clinicGeneral = { ...GENERAL_V1, title: 'Termo Geral da Clínica', content: 'Texto próprio da clínica' }
  const clinicBotox = { ...GENERAL_V1, id: 't-3', type: 'botox', title: 'Botox da Clínica', content: 'Texto botox da clínica', version: 2 }

  function openNovo(templates: Array<typeof GENERAL_V1>) {
    render(<ConsentTemplateList templates={templates} procedureTypes={[]} />)
    fireEvent.click(screen.getByRole('button', { name: /Novo/ }))
  }

  // Regression (PR #92 follow-up to FLORACLIN-1H): "Novo" on an existing type started from empty/built-in text, so saving
  // replaced the clinic's customized term with the default.
  it('starts from the clinic\'s active text of the selected type', () => {
    openNovo([clinicGeneral])

    expect(screen.getByLabelText(/Título/)).toHaveProperty('value', 'Termo Geral da Clínica')
    expect(screen.getByLabelText(/Conteúdo/)).toHaveProperty('value', 'Texto próprio da clínica')
  })

  it('re-prefills from the clinic\'s active text when switching to another existing type', () => {
    openNovo([clinicGeneral, clinicBotox])

    fireEvent.change(screen.getByLabelText('Tipo'), { target: { value: 'botox' } })

    screen.getByRole('button', { name: 'Salvar nova versão (v3)' })
    expect(screen.getByLabelText(/Título/)).toHaveProperty('value', 'Botox da Clínica')
    expect(screen.getByLabelText(/Conteúdo/)).toHaveProperty('value', 'Texto botox da clínica')
  })

  it('keeps text the user already edited when switching type', () => {
    openNovo([clinicGeneral, clinicBotox])

    fireEvent.change(screen.getByLabelText(/Conteúdo/), { target: { value: 'Minha edição' } })
    fireEvent.change(screen.getByLabelText('Tipo'), { target: { value: 'botox' } })

    // The switch itself happened (botox is v2 -> v3), but neither field was overwritten
    screen.getByRole('button', { name: 'Salvar nova versão (v3)' })
    expect(screen.getByLabelText(/Título/)).toHaveProperty('value', 'Termo Geral da Clínica')
    expect(screen.getByLabelText(/Conteúdo/)).toHaveProperty('value', 'Minha edição')
  })
})

describe('ConsentTemplateList procedure coverage', () => {
  const procedureTypes = [
    { name: 'Botox full face', category: 'botox', isActive: true },
    { name: 'Botox antigo', category: 'botox', isActive: false },
    { name: 'Skinbooster', category: 'skinbooster', isActive: true },
  ]

  it('names the active procedures each template covers', () => {
    render(
      <ConsentTemplateList
        procedureTypes={procedureTypes}
        templates={[
          { ...GENERAL_V1, id: 'b', type: 'botox', title: 'Termo Botox' },
          { ...GENERAL_V1, id: 's', type: 'skinbooster', title: 'Termo Skinbooster' },
          { ...GENERAL_V1, title: 'Termo Geral' },
        ]}
      />
    )

    const desktop = within(screen.getAllByRole('table')[0])
    const coverageOf = (title: string) => desktop.getByText(title).closest('tr')!.cells[2].textContent

    expect(coverageOf('Termo Botox')).toBe('Botox full face')
    expect(coverageOf('Termo Skinbooster')).toBe('Não exigido automaticamente')
    expect(coverageOf('Termo Geral')).toBe('Todos os procedimentos')
  })
})

describe('ConsentTemplateList empty state', () => {
  it('wires the empty state button to the restore mutation', () => {
    restoreDefaults.mockResolvedValue({ data: { created: 9 } })
    render(<ConsentTemplateList templates={[]} procedureTypes={[]} />)

    fireEvent.click(screen.getByRole('button', { name: 'Usar modelos padrão (9)' }))

    expect(restoreDefaults).toHaveBeenCalledTimes(1)
  })
})
