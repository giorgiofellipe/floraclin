/**
 * The booking link is edited in Settings > Agendamento now (it used to be set
 * once in onboarding and shown as unchangeable here).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BookingSettings } from '../booking-settings'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

function renderSettings() {
  const qc = new QueryClient()
  return render(
    <QueryClientProvider client={qc}>
      <BookingSettings slug="clinica-de-ana" publicBookingEnabled />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('BookingSettings link editing', () => {
  it('prefixes the slug field with the readable address, not a bare "/c/"', () => {
    renderSettings()
    const host = window.location.host
    expect(screen.getByTitle(`${host}/c/`)).toHaveTextContent(`${host}/c/`)
    expect(screen.getByText(/através de um link/)).toBeInTheDocument()
  })

  it('saves the new link through the tenant API and shows it', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ success: true, slug: 'studio-bella' }))
    renderSettings()

    const input = screen.getByLabelText('Endereço do link')
    expect(screen.getByRole('button', { name: 'Salvar link' })).toBeDisabled()
    await user.clear(input)
    await user.type(input, 'Studio Bella!')
    expect(input).toHaveValue('studiobella')
    await user.clear(input)
    await user.type(input, 'studio-bella')
    await user.click(screen.getByRole('button', { name: 'Salvar link' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/tenant')
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ slug: 'studio-bella', _action: 'booking_slug' })
    await waitFor(() => expect(screen.getByText(/\/c\/studio-bella$/)).toBeInTheDocument())
  })

  it('shows why a link was refused', async () => {
    const user = userEvent.setup()
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json({ error: 'Este link já está em uso. Escolha outro.' }, { status: 409 }),
    )
    renderSettings()
    const input = screen.getByLabelText('Endereço do link')
    await user.clear(input)
    await user.type(input, 'taken')
    await user.click(screen.getByRole('button', { name: 'Salvar link' }))

    expect(await screen.findByText('Este link já está em uso. Escolha outro.')).toBeInTheDocument()
    expect(screen.queryByText(/não pode ser alterado/)).toBeNull()
  })
})
