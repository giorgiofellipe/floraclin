import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('@/hooks/use-confirmation-resend', () => ({
  useConfirmationResend: () => ({ resend: vi.fn(), cooldown: 0, isPending: false, disabled: false }),
}))

import { AccountBanners } from '../account-banners'

const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString()

describe('AccountBanners', () => {
  // A new clinic had two stacked bars that pushed "Primeiros passos" off the phone screen.
  it('folds a calm trial and an unconfirmed e-mail into one line', () => {
    render(<AccountBanners subscriptionStatus="trialing" currentPeriodEnd={inDays(10)} unconfirmedEmail="ana@clinica.test" />)

    expect(screen.getByTestId('account-banner')).toHaveTextContent('Confirme seu e-mail')
    expect(screen.queryByTestId('email-confirmation-banner')).not.toBeInTheDocument()
  })

  it('closes only the trial part; the e-mail reminder stays', async () => {
    render(<AccountBanners subscriptionStatus="trialing" currentPeriodEnd={inDays(10)} unconfirmedEmail="ana@clinica.test" />)

    await userEvent.click(screen.getByRole('button', { name: 'Fechar aviso do teste gratuito' }))

    expect(screen.getByTestId('account-banner')).not.toHaveTextContent('Teste gratuito')
    expect(screen.getByTestId('account-banner')).toHaveTextContent('Confirme seu e-mail')
  })

  it('keeps an urgent trial notice on its own bar next to the e-mail one', () => {
    render(<AccountBanners subscriptionStatus="trialing" currentPeriodEnd={inDays(2)} unconfirmedEmail="ana@clinica.test" />)

    expect(screen.getByTestId('trial-banner-ending')).toBeInTheDocument()
    expect(screen.getByTestId('email-confirmation-banner')).toBeInTheDocument()
    expect(screen.queryByTestId('account-banner')).not.toBeInTheDocument()
  })

  it('shows only the trial notice once the e-mail is confirmed', () => {
    render(<AccountBanners subscriptionStatus="trialing" currentPeriodEnd={inDays(10)} unconfirmedEmail={null} />)

    expect(screen.getByText(/Teste gratuito · \d+ dias restantes/)).toBeInTheDocument()
    expect(screen.queryByTestId('account-banner')).not.toBeInTheDocument()
  })
})
