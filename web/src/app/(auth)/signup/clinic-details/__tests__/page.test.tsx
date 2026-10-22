import { describe, expect, it, vi, beforeEach } from 'vitest'
import { act, fireEvent, render, waitFor } from '@testing-library/react'

const h = vi.hoisted(() => ({
  update: vi.fn(),
  replace: vi.fn(),
  trackMetaEvent: vi.fn(),
  createClinic: vi.fn(),
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
vi.mock('@/actions/signup', () => ({ createClinicForOAuthUser: (...a: unknown[]) => h.createClinic(...a) }))
vi.mock('@/components/marketing/signup-attribution-fields', () => ({ SignupAttributionFields: () => null }))

import ClinicDetailsPage from '../page'

const MAX_SESSION_CHANGES = 5

beforeEach(() => {
  vi.clearAllMocks()
  h.createClinic.mockResolvedValue({ success: true, created: true, metaEventId: 'complete_registration:1' })
  // Like the real update(): resolves, then the session (and so `update`) changes.
  // Capped so the pre-fix loop ends in a failed assertion rather than a hang.
  h.update.mockImplementation(async () => {
    if (h.update.mock.calls.length < MAX_SESSION_CHANGES) h.rerenderSession?.()
    return { tenantId: 'tenant-1' }
  })
})

describe('clinic details after Google sign-up', () => {
  it('refreshes the token with a POST-style update, fires CompleteRegistration once, then navigates', async () => {
    const { container } = render(<ClinicDetailsPage />)
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
    const { container } = render(<ClinicDetailsPage />)
    await act(async () => {
      fireEvent.submit(container.querySelector('form')!)
    })

    await waitFor(() => expect(h.replace).toHaveBeenCalledWith('/dashboard'))
    await act(async () => {})

    expect(h.update).toHaveBeenCalledTimes(2)
    expect(h.replace).toHaveBeenCalledTimes(1)
    expect(h.trackMetaEvent).toHaveBeenCalledTimes(1)
  })
})
