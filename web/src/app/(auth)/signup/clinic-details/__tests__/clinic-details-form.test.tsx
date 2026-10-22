import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, waitFor } from '@testing-library/react'

const h = vi.hoisted(() => ({
  update: vi.fn(),
  replace: vi.fn(),
  trackMetaEvent: vi.fn(),
  createClinic: vi.fn(),
  signOut: vi.fn(),
  rerenderSession: null as null | (() => void),
}))

// useSession hands out a new `update` whenever the session changes, the way
// next-auth's SessionProvider does (its value is memoised on the session).
vi.mock('next-auth/react', async () => {
  const React = await import('react')
  return {
    useSession: () => {
      const [, setTick] = React.useState(0)
      h.rerenderSession = () => setTick((t) => t + 1)
      return { update: (...args: unknown[]) => h.update(...args) }
    },
  }
})
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: h.replace }) }))
vi.mock('@/lib/marketing-attribution', () => ({ trackMetaEvent: (...a: unknown[]) => h.trackMetaEvent(...a) }))
vi.mock('@/actions/signup', () => ({
  createClinicForOAuthUser: (...a: unknown[]) => h.createClinic(...a),
  signOutFromClinicDetails: (...a: unknown[]) => h.signOut(...a),
}))
vi.mock('@/components/marketing/signup-attribution-fields', () => ({ SignupAttributionFields: () => null }))

import {
  ClinicDetailsForm,
  MAX_SESSION_REFRESH_ATTEMPTS,
  SESSION_REFRESH_FAILED_MESSAGE,
  SESSION_REFRESH_RETRY_MS,
} from '../clinic-details-form'
import { SUSPENDED_CLINIC_MESSAGE } from '@/lib/clinic-suspended'

const MAX_SESSION_CHANGES = 5

beforeEach(() => {
  // The refresh retries wait SESSION_REFRESH_RETRY_MS; tests advance it
  // instead of sleeping through it.
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.clearAllMocks()
  h.createClinic.mockResolvedValue({ success: true, created: true, metaEventId: 'complete_registration:1' })
  // Like the real update(): resolves, then the session (and so `update`) changes.
  // Capped so the pre-fix loop ends in a failed assertion rather than a hang.
  h.update.mockImplementation(async () => {
    if (h.update.mock.calls.length < MAX_SESSION_CHANGES) h.rerenderSession?.()
    return { tenantId: 'tenant-1' }
  })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('clinic details after Google sign-up', () => {
  it('refreshes the token with a POST-style update, fires CompleteRegistration once, then navigates', async () => {
    const { container } = render(<ClinicDetailsForm />)
    await act(async () => {
      fireEvent.submit(container.querySelector('form')!)
    })

    await waitFor(() => expect(h.replace).toHaveBeenCalledWith('/dashboard'))
    // Flush any re-run of the effect before counting.
    await act(async () => {})

    // update() with no data is a GET that never refreshes the JWT.
    expect(h.update).toHaveBeenCalledWith({})
    expect(h.update).toHaveBeenCalledTimes(1)
    expect(h.trackMetaEvent).toHaveBeenCalledTimes(1)
  })

  it('retries a refresh that came back empty, without firing the pixel again', async () => {
    h.update.mockImplementationOnce(async () => {
      h.rerenderSession?.()
      return null
    })
    const { container } = render(<ClinicDetailsForm />)
    await act(async () => {
      fireEvent.submit(container.querySelector('form')!)
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SESSION_REFRESH_RETRY_MS)
    })

    await waitFor(() => expect(h.replace).toHaveBeenCalledWith('/dashboard'))
    await act(async () => {})

    expect(h.update).toHaveBeenCalledTimes(2)
    expect(h.replace).toHaveBeenCalledTimes(1)
    expect(h.trackMetaEvent).toHaveBeenCalledTimes(1)
  })

  it('stops with an explicit error, without navigating, when no refresh resolves a tenant', async () => {
    // The loop in production: the clinic "exists" but the session never gets a
    // tenant, so /dashboard bounces straight back here.
    h.createClinic.mockResolvedValue({ success: true, created: false })
    h.update.mockResolvedValue({ tenantId: null })
    const { container, findByRole } = render(<ClinicDetailsForm />)
    await act(async () => {
      fireEvent.submit(container.querySelector('form')!)
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SESSION_REFRESH_RETRY_MS * (MAX_SESSION_REFRESH_ATTEMPTS - 1))
    })

    const alert = await findByRole('alert')
    expect(alert.textContent).toContain(SESSION_REFRESH_FAILED_MESSAGE)
    expect(h.update).toHaveBeenCalledTimes(MAX_SESSION_REFRESH_ATTEMPTS)
    expect(h.replace).not.toHaveBeenCalled()
    expect(h.trackMetaEvent).not.toHaveBeenCalled()

    // "Tentar de novo" refreshes the token again; a plain reload would not.
    h.update.mockResolvedValue({ tenantId: 'tenant-1' })
    await act(async () => {
      fireEvent.click(await findByRole('button', { name: 'Tentar de novo' }))
    })
    await waitFor(() => expect(h.replace).toHaveBeenCalledWith('/dashboard'))
  })

  it('keeps the form while refreshing when the action re-renders the page with the new clinic', async () => {
    // Setting the tenant cookie in the action re-renders the server page,
    // which now finds a live clinic.
    let resolveUpdate: (v: unknown) => void = () => {}
    h.update.mockImplementation(() => new Promise((r) => { resolveUpdate = r }))
    const { container, rerender, queryByRole } = render(<ClinicDetailsForm />)
    await act(async () => {
      fireEvent.submit(container.querySelector('form')!)
    })
    rerender(<ClinicDetailsForm hasClinic />)

    expect(container.querySelector('form')).not.toBeNull()
    expect(queryByRole('button', { name: 'Entrar na clínica' })).toBeNull()
    expect(container.querySelector('button[type=submit]')!.hasAttribute('disabled')).toBe(true)

    await act(async () => resolveUpdate({ tenantId: 'tenant-1' }))
    await waitFor(() => expect(h.replace).toHaveBeenCalledTimes(1))
    expect(h.update).toHaveBeenCalledTimes(1)
  })

  it('shows the suspension notice from the action and no form', async () => {
    h.createClinic.mockResolvedValue({ suspended: true, error: { general: [SUSPENDED_CLINIC_MESSAGE] } })
    const { container, findByText } = render(<ClinicDetailsForm />)
    await act(async () => {
      fireEvent.submit(container.querySelector('form')!)
    })

    expect(await findByText(SUSPENDED_CLINIC_MESSAGE)).toBeTruthy()
    expect(container.querySelector('form')).toBeNull()
    expect(h.update).not.toHaveBeenCalled()
    expect(h.replace).not.toHaveBeenCalled()
  })
})

describe('clinic details for a user who is not new', () => {
  it('shows the suspension notice up front for a suspended-only user', () => {
    const { container, getByText } = render(<ClinicDetailsForm suspended />)
    expect(getByText(SUSPENDED_CLINIC_MESSAGE)).toBeTruthy()
    expect(container.querySelector('form')).toBeNull()
  })

  it('signs out through the action that also drops the tenant cookie', async () => {
    const { getByRole } = render(<ClinicDetailsForm suspended />)
    await act(async () => {
      fireEvent.click(getByRole('button', { name: 'Sair' }))
    })
    expect(h.signOut).toHaveBeenCalledTimes(1)
  })

  it('offers to enter an existing clinic instead of asking for it again', async () => {
    const { container, getByRole } = render(<ClinicDetailsForm hasClinic />)
    expect(container.querySelector('form')).toBeNull()
    await act(async () => {
      fireEvent.click(getByRole('button', { name: 'Entrar na clínica' }))
    })
    await waitFor(() => expect(h.replace).toHaveBeenCalledWith('/dashboard'))
    expect(h.update).toHaveBeenCalledWith({})
    expect(h.createClinic).not.toHaveBeenCalled()
  })

  it('after a failed refresh, offers one way to retry, not two buttons doing the same thing', async () => {
    h.update.mockResolvedValue({ tenantId: null })
    const { getByRole, findByRole, queryByRole } = render(<ClinicDetailsForm hasClinic />)
    await act(async () => {
      fireEvent.click(getByRole('button', { name: 'Entrar na clínica' }))
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SESSION_REFRESH_RETRY_MS * (MAX_SESSION_REFRESH_ATTEMPTS - 1))
    })

    expect(await findByRole('button', { name: 'Tentar de novo' })).toBeTruthy()
    expect(queryByRole('button', { name: 'Entrar na clínica' })).toBeNull()
    expect(h.replace).not.toHaveBeenCalled()
  })
})
