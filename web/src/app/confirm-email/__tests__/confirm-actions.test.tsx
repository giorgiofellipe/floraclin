/**
 * The page the confirmation link opens reads the same on a phone and on a
 * desktop: no "toque".
 */
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('@/actions/auth', () => ({ loginWithGoogle: vi.fn() }))
vi.mock('@/actions/confirm-email', () => ({ confirmEmail: vi.fn() }))
vi.mock('@/hooks/use-confirmation-resend', () => ({
  useConfirmationResend: () => ({ resend: vi.fn(), cooldown: 0, disabled: false }),
}))

import { ConfirmActions } from '../confirm-actions'

describe('ConfirmActions with a token', () => {
  it('asks for the confirmation in device-neutral words, with the address in bold', () => {
    const { container } = render(<ConfirmActions email="ana@clinica.test" hasToken />)

    expect(container).toHaveTextContent(
      'Confirme ana@clinica.test no botão abaixo para continuar a configuração da sua clínica.',
    )
    expect(container).not.toHaveTextContent(/toque/i)
    expect(screen.getByText('ana@clinica.test').tagName).toBe('STRONG')
    expect(screen.getByTestId('confirm-email-submit')).toHaveTextContent('Confirmar e-mail')
  })
})
