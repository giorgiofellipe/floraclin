import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('@/actions/auth', () => ({ loginWithGoogle: vi.fn() }))
vi.mock('@/actions/confirm-email', () => ({ confirmEmail: vi.fn() }))
vi.mock('@/hooks/use-confirmation-resend', () => ({
  useConfirmationResend: () => ({ resend: vi.fn(), cooldown: 0, disabled: false }),
}))

import { AlreadyConfirmed } from '../confirm-actions'

describe('AlreadyConfirmed', () => {
  // Catches the address riding into /login's URL, which Meta Pixel and PostHog read.
  it('sends the owner to sign in without the address in the URL', () => {
    render(<AlreadyConfirmed email="ana@clinica.test" />)
    expect(screen.getByTestId('confirm-email-login')).toHaveAttribute('href', '/login')
  })
})
