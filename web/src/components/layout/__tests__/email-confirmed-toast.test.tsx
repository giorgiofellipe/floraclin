/**
 * After the confirmation link signs the owner in, the page they land on says
 * "E-mail confirmado." once and drops the parameter, so a reload or Back does
 * not say it again.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { StrictMode } from 'react'
import { render } from '@testing-library/react'

const { router, toast } = vi.hoisted(() => ({
  router: { replace: vi.fn() },
  toast: { success: vi.fn() },
}))
vi.mock('next/navigation', () => ({ useRouter: () => router }))
vi.mock('sonner', () => ({ toast }))

import { EmailConfirmedToast } from '../email-confirmed-toast'

beforeEach(() => {
  vi.clearAllMocks()
  window.history.replaceState(null, '', '/onboarding?email_confirmed=1')
})

describe('EmailConfirmedToast', () => {
  it('toasts once, even when effects run twice, and drops the parameter without scrolling', () => {
    render(
      <StrictMode>
        <EmailConfirmedToast show />
      </StrictMode>,
    )

    expect(toast.success).toHaveBeenCalledTimes(1)
    expect(toast.success).toHaveBeenCalledWith('E-mail confirmado.')
    expect(router.replace).toHaveBeenCalledTimes(1)
    expect(router.replace).toHaveBeenCalledWith('/onboarding', { scroll: false })
  })

  it('keeps the rest of the URL', () => {
    window.history.replaceState(null, '', '/dashboard?primeiro_paciente=1&email_confirmed=1#topo')
    render(<EmailConfirmedToast show />)
    expect(router.replace).toHaveBeenCalledWith('/dashboard?primeiro_paciente=1#topo', { scroll: false })
  })

  it('does nothing without the parameter', () => {
    render(<EmailConfirmedToast show={false} />)
    expect(toast.success).not.toHaveBeenCalled()
    expect(router.replace).not.toHaveBeenCalled()
  })
})
