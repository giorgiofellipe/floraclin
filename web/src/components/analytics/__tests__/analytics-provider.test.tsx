/**
 * The provider follows the cookie banner: the same `saveCookieConsent` the
 * banner calls switches PostHog between cookieless and consented mode, in
 * both directions, with the real posthog-js underneath (network stubbed).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import type { PostHog } from 'posthog-js'

const KEY = 'phc_test_key'

function phEntries(): string[] {
  const cookies = document.cookie.split(';').map((c) => c.trim().split('=')[0])
  return [...cookies, ...Object.keys(localStorage), ...Object.keys(sessionStorage)].filter((k) => k.startsWith('ph_'))
}

let posthog: PostHog

async function load() {
  vi.resetModules()
  const actual = await vi.importActual<typeof import('posthog-js')>('posthog-js')
  posthog = new actual.PostHog()
  vi.doMock('posthog-js', () => ({ default: posthog }))
  const [{ AnalyticsProvider }, consent] = await Promise.all([
    import('../analytics-provider'),
    import('@/lib/cookie-consent'),
  ])
  return { AnalyticsProvider, saveCookieConsent: consent.saveCookieConsent }
}

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', KEY)
  vi.stubEnv('NEXT_PUBLIC_POSTHOG_HOST', 'http://127.0.0.1:9')
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })))
})

afterEach(() => {
  vi.doUnmock('posthog-js')
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  localStorage.clear()
  sessionStorage.clear()
  for (const c of document.cookie.split(';')) {
    const name = c.split('=')[0]?.trim()
    if (name) document.cookie = `${name}=; Max-Age=0; Path=/`
  }
})

describe('AnalyticsProvider', () => {
  it('starts cookieless with no banner choice, upgrades on accept and reverts on reject', async () => {
    const { AnalyticsProvider, saveCookieConsent } = await load()
    render(<AnalyticsProvider userId="user-1" tenantId="tenant-1" />)

    await waitFor(() => expect(posthog.get_distinct_id()).toBe('user-1'))
    expect(posthog.config.persistence).toBe('memory')
    expect(posthog.config.autocapture).toBe(false)
    expect(phEntries()).toEqual([])

    saveCookieConsent(true)
    await waitFor(() => expect(posthog.config.persistence).toBe('localStorage+cookie'))
    expect(posthog.config.autocapture).toBe(true)
    expect(posthog.config.disable_session_recording).toBe(false)

    saveCookieConsent(false)
    await waitFor(() => expect(posthog.config.persistence).toBe('memory'))
    expect(posthog.config.autocapture).toBe(false)
    expect(posthog.config.disable_session_recording).toBe(true)
    expect(phEntries()).toEqual([])
  })

  it('starts in consented mode straight away when consent was stored earlier', async () => {
    const { AnalyticsProvider, saveCookieConsent } = await load()
    saveCookieConsent(true)
    render(<AnalyticsProvider />)

    await waitFor(() => expect(posthog.__loaded).toBe(true))
    expect(posthog.config.persistence).toBe('localStorage+cookie')
  })

  it('stays cookieless when the stored choice is a rejection', async () => {
    const { AnalyticsProvider, saveCookieConsent } = await load()
    saveCookieConsent(false)
    render(<AnalyticsProvider userId="user-1" tenantId="tenant-1" />)

    await waitFor(() => expect(posthog.get_distinct_id()).toBe('user-1'))
    expect(posthog.config.persistence).toBe('memory')
    expect(phEntries()).toEqual([])
  })

  it('sends nothing and identifies no one where tracking is disabled, even mid-session', async () => {
    const { AnalyticsProvider } = await load()
    const { track } = await import('@/lib/analytics/client')
    // The session starts on /login (tracked), then continues as a platform admin.
    const { rerender } = render(<AnalyticsProvider />)
    await waitFor(() => expect(posthog.__loaded).toBe(true))
    const sent: string[] = []
    posthog.on('eventCaptured', (event) => sent.push(event.event))

    rerender(<AnalyticsProvider userId="admin-1" tenantId="tenant-1" enabled={false} />)
    track('onboarding_step_viewed', { step_index: 0, step_name: 'clinic' })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(sent).toEqual([])
    expect(posthog.get_distinct_id()).not.toBe('admin-1')
  })

  it.each([
    ['no banner choice', null],
    ['a stored rejection', false],
  ] as const)('clears PostHog storage where tracking is disabled, with %s and no instance yet', async (_, choice) => {
    const { AnalyticsProvider, saveCookieConsent } = await load()
    if (choice !== null) saveCookieConsent(choice)
    localStorage.setItem(`ph_${KEY}_posthog`, '{"distinct_id":"old"}')
    sessionStorage.setItem(`ph_${KEY}_window_id`, 'w')
    document.cookie = `ph_${KEY}_posthog=old; Path=/`

    render(<AnalyticsProvider enabled={false} />)

    await waitFor(() => expect(phEntries()).toEqual([]))
    expect(posthog.__loaded).toBeFalsy()
  })
})
