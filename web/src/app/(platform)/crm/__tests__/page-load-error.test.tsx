/**
 * The prospects API refuses with 403 when WhatsApp is off or the role may not
 * use the CRM. The board used to swallow that and show six empty columns
 * ("0 leads"); it must say why, and offer the WhatsApp setup only to someone
 * who can open it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }))
vi.mock('sonner', () => ({ toast }))

vi.mock('@/components/crm/kanban-board', () => ({ KanbanBoard: () => <div data-testid="board" /> }))
vi.mock('@/components/crm/add-prospect-modal', () => ({ AddProspectModal: () => null }))

import CrmPage from '../page'

afterEach(() => vi.unstubAllGlobals())

function refuse(body: Record<string, unknown>) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status: 403 })))
}

describe('CRM page when the prospects request is refused', () => {
  it('shows the reason and the WhatsApp setup link to an owner', async () => {
    refuse({ error: 'WhatsApp não está habilitado', code: 'whatsapp_disabled', canConfigure: true })

    render(<CrmPage />)

    expect(await screen.findByRole('alert')).toHaveTextContent('WhatsApp não está habilitado')
    expect(screen.getByRole('link', { name: 'Configurar WhatsApp' })).toHaveAttribute('href', '/configuracoes?tab=whatsapp')
    expect(screen.queryByTestId('board')).not.toBeInTheDocument()
  })

  it.each([
    ['WhatsApp is off for a non-owner', { error: 'WhatsApp não está habilitado', code: 'whatsapp_disabled', canConfigure: false }],
    ['the role may not use the CRM', { error: 'Sem permissão para acessar o CRM', code: 'crm_forbidden' }],
  ])('shows the reason without a setup link when %s', async (_case, body) => {
    refuse(body)

    render(<CrmPage />)

    expect(await screen.findByRole('alert')).toHaveTextContent(body.error)
    expect(screen.queryByRole('link', { name: 'Configurar WhatsApp' })).not.toBeInTheDocument()
    expect(screen.queryByTestId('board')).not.toBeInTheDocument()
  })
})

describe('CRM page when a later request fails', () => {
  // A failed refresh after the board loaded must not wipe the working board.
  it('keeps the board and reports the failure in a toast', async () => {
    const loaded = { data: [], stats: { novo: 0, contatado: 0, qualificado: 0, agendado: 0, convertido: 0, perdido: 0 } }
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(loaded), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    render(<CrmPage />)
    await screen.findByTestId('board')

    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ error: 'Erro interno' }), { status: 500 }))
    await userEvent.click(screen.getByRole('button', { name: /Atualizar/ }))

    expect(toast.error).toHaveBeenCalledWith('Erro interno')
    expect(screen.getByTestId('board')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
