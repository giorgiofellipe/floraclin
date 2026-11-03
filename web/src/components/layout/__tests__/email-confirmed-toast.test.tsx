/**
 * After the confirmation link signs the owner in, the page they land on says
 * "E-mail confirmado." once and drops the parameter, so a reload or Back does
 * not say it again.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { StrictMode } from 'react'
import { render } from '@testing-library/react'

const { toast } = vi.hoisted(() => ({ toast: { success: vi.fn() } }))
vi.mock('sonner', () => ({ toast }))

import { EmailConfirmedToast } from '../email-confirmed-toast'

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  window.history.replaceState(null, '', '/onboarding?email_confirmed=1')
})

afterEach(() => {
  vi.useRealTimers()
})

describe('EmailConfirmedToast', () => {
  it('toasts once, even when effects run twice, then drops the parameter from the URL', () => {
    render(
      <StrictMode>
        <EmailConfirmedToast show />
      </StrictMode>,
    )

    expect(toast.success).toHaveBeenCalledTimes(1)
    expect(toast.success).toHaveBeenCalledWith('E-mail confirmado.')
    // Not in the commit that toasts: the router patches replaceState only after it.
    expect(window.location.search).toBe('?email_confirmed=1')

    vi.runAllTimers()
    expect(`${window.location.pathname}${window.location.search}`).toBe('/onboarding')
  })

  it('keeps the rest of the URL', () => {
    window.history.replaceState(null, '', '/dashboard?primeiro_paciente=1&email_confirmed=1#topo')
    render(<EmailConfirmedToast show />)
    vi.runAllTimers()
    expect(`${window.location.pathname}${window.location.search}${window.location.hash}`).toBe(
      '/dashboard?primeiro_paciente=1#topo',
    )
  })

  // Catches the replace wiping the state Next's router keeps in history, which Back relies on.
  it('keeps the router state of the history entry', () => {
    const routerState = { __NA: true, __PRIVATE_NEXTJS_INTERNALS_TREE: ['', {}] }
    window.history.replaceState(routerState, '', '/onboarding?email_confirmed=1')
    render(<EmailConfirmedToast show />)
    vi.runAllTimers()
    expect(window.history.state).toEqual(routerState)
  })

  it('does nothing without the parameter', () => {
    render(<EmailConfirmedToast show={false} />)
    vi.runAllTimers()
    expect(toast.success).not.toHaveBeenCalled()
    expect(window.location.search).toBe('?email_confirmed=1')
  })
})
