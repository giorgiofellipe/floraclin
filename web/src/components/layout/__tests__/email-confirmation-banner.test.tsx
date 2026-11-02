import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
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
    const banner = screen.getByRole('region', { name: 'Confirmação de e-mail pendente' })
    expect(banner).toHaveTextContent('ana@clinica.test')
    expect(banner).toHaveTextContent(/WhatsApp/)
    expect(banner).toHaveTextContent(/convidar sua equipe/)
    expect(screen.getByTestId('email-confirmation-full')).toHaveTextContent(
      'Confirme seu e-mail ana@clinica.test para enviar mensagens por WhatsApp, convidar sua equipe e assinar um plano.',
    )
    // Not a live region: it would be read out on every page load.
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('shortens the copy to one sentence on phones and keeps the full one from sm up', () => {
    render(<EmailConfirmationBanner email="ana@clinica.test" />)
    const short = screen.getByTestId('email-confirmation-short')
    const full = screen.getByTestId('email-confirmation-full')
    expect(short).toHaveClass('sm:hidden')
    expect(full).toHaveClass('hidden', 'sm:inline')
    // The address is not printed on phones, but the title and screen readers still get it.
    expect(short).toHaveTextContent('Confirme seu e-mail ana@clinica.test para liberar WhatsApp, convites e planos.')
    expect(short).toHaveAttribute('title', 'ana@clinica.test')
    expect(within(short).getByText('ana@clinica.test')).toHaveClass('sr-only')
  })

  it('keeps a long address on one line, with the full address in the title', () => {
    const email = 'ana.souza.estetica.c659ca03@example.test'
    render(<EmailConfirmationBanner email={email} />)
    const address = within(screen.getByTestId('email-confirmation-full')).getByText(email)
    expect(address).toHaveAttribute('title', email)
    expect(address).toHaveClass('truncate')
  })

  it('gives the resend button a 44px tap target on phones', () => {
    render(<EmailConfirmationBanner email="ana@clinica.test" />)
    expect(screen.getByRole('button', { name: 'Reenviar link' })).toHaveClass('min-h-11', 'sm:min-h-9')
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
