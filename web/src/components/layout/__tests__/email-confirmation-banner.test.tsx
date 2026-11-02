import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from 'sonner'
import { EmailConfirmationBanner } from '../email-confirmation-banner'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

beforeEach(() => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

describe('EmailConfirmationBanner', () => {
  it('says what waits on the confirmation, without blocking anything', () => {
    render(<EmailConfirmationBanner email="ana@clinica.test" />)
    const banner = screen.getByRole('status')
    expect(banner).toHaveTextContent('ana@clinica.test')
    expect(banner).toHaveTextContent(/WhatsApp/)
    expect(banner).toHaveTextContent(/convidar sua equipe/)
  })

  it('resends through the existing endpoint, then holds the button for the cooldown', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ success: true }))
    render(<EmailConfirmationBanner email="ana@clinica.test" />)

    await user.click(screen.getByRole('button', { name: 'Reenviar link' }))

    await waitFor(() => expect(toast.success).toHaveBeenCalled())
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/confirm/resend',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ email: 'ana@clinica.test' }) }),
    )
    expect(screen.getByRole('button', { name: /Reenviar link \(\d+s\)/ })).toBeDisabled()
  })

  it('tells the owner when the resend failed', async () => {
    const user = userEvent.setup()
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 500 }))
    render(<EmailConfirmationBanner email="ana@clinica.test" />)
    await user.click(screen.getByRole('button', { name: 'Reenviar link' }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Não foi possível reenviar o link agora.'))
  })
})
