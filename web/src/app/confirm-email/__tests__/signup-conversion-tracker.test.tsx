import { afterEach, describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'

const { trackMetaEvent } = vi.hoisted(() => ({ trackMetaEvent: vi.fn() }))
vi.mock('@/lib/marketing-attribution', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/marketing-attribution')>()),
  trackMetaEvent,
}))

import { SignupConversionTracker } from '../signup-conversion-tracker'

afterEach(() => {
  window.history.replaceState(null, '', '/')
  trackMetaEvent.mockClear()
})

describe('SignupConversionTracker', () => {
  it('fires CompleteRegistration with the server event id, then drops the id from the URL', () => {
    window.history.replaceState({ kept: true }, '', '/onboarding?meta_event_id=evt-1&utm_source=ig')

    render(<SignupConversionTracker eventId="evt-1" />)

    expect(trackMetaEvent).toHaveBeenCalledWith('CompleteRegistration', { status: 'trial_started' }, 'evt-1')
    expect(window.location.pathname + window.location.search).toBe('/onboarding?utm_source=ig')
    // The router keeps its own state in history.state; it must survive.
    expect(window.history.state).toEqual({ kept: true })
  })

  it('fires nothing and leaves the URL alone without an id', () => {
    window.history.replaceState(null, '', '/onboarding?utm_source=ig')

    render(<SignupConversionTracker eventId={null} />)

    expect(trackMetaEvent).not.toHaveBeenCalled()
    expect(window.location.search).toBe('?utm_source=ig')
  })
})
