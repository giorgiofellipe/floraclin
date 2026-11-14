import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PatientSearch } from '../patient-search'

const push = vi.hoisted(() => vi.fn())
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))

const usePatientSearch = vi.hoisted(() => vi.fn())
vi.mock('@/hooks/queries/use-patients', () => ({ usePatientSearch }))

// cmdk measures its list; jsdom has no layout.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
}
Element.prototype.scrollIntoView ??= () => {}

describe('PatientSearch', () => {
  beforeEach(() => {
    push.mockClear()
    usePatientSearch.mockImplementation((search: string) => ({
      data: search === 'mar' ? [{ id: 'p1', fullName: 'Maria Silva', phone: '11999990001' }] : [],
      isFetching: false,
    }))
  })

  it('opens with Ctrl+K and goes to the picked patient', async () => {
    render(<PatientSearch />)
    await userEvent.keyboard('{Control>}k{/Control}')
    await userEvent.type(await screen.findByPlaceholderText('Nome, telefone ou CPF'), 'mar')

    await userEvent.click(await screen.findByText('Maria Silva'))
    expect(push).toHaveBeenCalledWith('/pacientes/p1')
  })

  it('says when no patient matches', async () => {
    render(<PatientSearch />)
    await userEvent.click(screen.getByRole('button', { name: 'Buscar paciente' }))
    await userEvent.type(await screen.findByPlaceholderText('Nome, telefone ou CPF'), 'zzz')
    expect(await screen.findByText('Nenhum paciente encontrado.')).toBeInTheDocument()
  })
})
