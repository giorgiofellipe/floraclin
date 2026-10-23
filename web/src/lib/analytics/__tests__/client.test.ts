/**
 * The browser side of the consent design, against the real posthog-js in
 * jsdom: what it writes to the device and what it would send, before consent,
 * after it is granted, and after it is withdrawn.
 *
 * Network is stubbed and api_host points at a closed local port; nothing
 * leaves the machine.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CaptureResult, PostHog } from 'posthog-js'

type ClientModule = typeof import('../client')

const KEY = 'phc_test_key'

function phCookies(): string[] {
  return document.cookie
    .split(';')
    .map((c) => c.trim())
    .filter((c) => c.startsWith('ph_') || c.startsWith('__ph_'))
}

function phStorageKeys(storage: Storage): string[] {
  return Object.keys(storage).filter((k) => k.startsWith('ph_') || k.startsWith('__ph_'))
}

function clearDevice() {
  localStorage.clear()
  sessionStorage.clear()
  for (const c of document.cookie.split(';')) {
    const name = c.split('=')[0]?.trim()
    if (name) document.cookie = `${name}=; Max-Age=0; Path=/`
  }
}

/**
 * A fresh client module and a fresh PostHog instance per test. posthog-js is
 * loaded once per worker, so its default singleton would otherwise carry one
 * test's init into the next.
 */
async function loadClient(): Promise<ClientModule> {
  vi.resetModules()
  const actual = await vi.importActual<typeof import('posthog-js')>('posthog-js')
  vi.doMock('posthog-js', () => ({ default: new actual.PostHog() }))
  return import('../client')
}

/** Lets the client's promise callbacks run. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

async function start(client: ClientModule, consentGranted: boolean) {
  const posthog = (await client.initAnalytics({ consentGranted })) as PostHog
  expect(posthog).not.toBeNull()
  const sent: CaptureResult[] = []
  posthog.on('eventCaptured', (event) => sent.push(event))
  return { posthog, sent }
}

beforeEach(() => {
  clearDevice()
  vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', KEY)
  vi.stubEnv('NEXT_PUBLIC_POSTHOG_HOST', 'http://127.0.0.1:9')
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })))
})

afterEach(() => {
  vi.doUnmock('posthog-js')
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  clearDevice()
})

describe('without consent (cookieless)', () => {
  it('initialises with memory persistence and nothing optional switched on', async () => {
    const client = await loadClient()
    const { posthog } = await start(client, false)

    expect(posthog.config.persistence).toBe('memory')
    expect(posthog.config.autocapture).toBe(false)
    expect(posthog.config.capture_pageview).toBe(false)
    expect(posthog.config.disable_session_recording).toBe(true)
    expect(posthog.config.enable_heatmaps).toBe(false)
    expect(posthog.config.capture_dead_clicks).toBe(false)
    expect(posthog.config.disable_surveys).toBe(true)
    expect(posthog.config.person_profiles).toBe('identified_only')
    expect(posthog.sessionRecordingStarted()).toBe(false)
  })

  it('writes no PostHog cookie, localStorage or sessionStorage entry, even through identify and reset', async () => {
    const client = await loadClient()
    const { posthog } = await start(client, false)

    client.track('signup_started', { method: 'email', in_app_browser: false })
    client.identifyAnalyticsUser('user-1', 'tenant-1')
    await flush()
    posthog.capture('$pageview')
    client.resetAnalytics()
    await flush()

    expect(phCookies()).toEqual([])
    expect(phStorageKeys(localStorage)).toEqual([])
    expect(phStorageKeys(sessionStorage)).toEqual([])
  })

  it('sends only the funnel events and identity calls', async () => {
    const client = await loadClient()
    const { posthog, sent } = await start(client, false)

    client.track('login_failed', { method: 'email', reason: 'invalid_credentials', in_app_browser: false })
    client.identifyAnalyticsUser('user-1', 'tenant-1')
    await flush()
    posthog.capture('$pageview')
    posthog.capture('$autocapture', { $event_type: 'click' })
    posthog.capture('$snapshot', { $snapshot_data: [] })
    posthog.capture('some_custom_event')

    expect(sent.map((e) => e.event)).toEqual(['login_failed', '$identify', '$groupidentify'])
    expect(sent[1].properties.distinct_id).toBe('user-1')
    expect(sent[2].properties.$group_type).toBe('tenant')
    expect(sent[2].properties.$group_key).toBe('tenant-1')
    // identify() and group() are sent without person or group properties.
    expect(sent[1].$set ?? {}).toEqual({})
    expect(sent[2].properties.$group_set ?? {}).toEqual({})
  })

  it('clears PostHog storage left over from an earlier, since withdrawn, consent', async () => {
    localStorage.setItem(`ph_${KEY}_posthog`, '{"distinct_id":"old"}')
    sessionStorage.setItem(`ph_${KEY}_window_id`, 'w')
    document.cookie = `ph_${KEY}_posthog=old; Path=/`

    const client = await loadClient()
    await start(client, false)

    expect(phCookies()).toEqual([])
    expect(phStorageKeys(localStorage)).toEqual([])
    expect(phStorageKeys(sessionStorage)).toEqual([])
  })
})

describe('granting consent', () => {
  it('switches on persistence, autocapture, pageviews, heatmaps and session replay (inputs masked)', async () => {
    const client = await loadClient()
    const { posthog, sent } = await start(client, false)
    const startRecording = vi.spyOn(posthog, 'startSessionRecording')

    await client.applyAnalyticsConsent(true)

    expect(posthog.config.persistence).toBe('localStorage+cookie')
    expect(posthog.config.autocapture).toBe(true)
    expect(posthog.config.enable_heatmaps).toBe(true)
    expect(posthog.config.capture_pageview).toBe('history_change')
    expect(startRecording).toHaveBeenCalled()
    expect(posthog.config.disable_session_recording).toBe(false)
    expect(posthog.config.session_recording.maskAllInputs).toBe(true)
    // The grant itself counts the page being looked at.
    expect(sent.map((e) => e.event)).toContain('$pageview')

    posthog.capture('$autocapture', { $event_type: 'click' })
    expect(sent.map((e) => e.event)).toContain('$autocapture')
  })

  it('starts in consented mode when consent was already given', async () => {
    const client = await loadClient()
    const { posthog } = await start(client, true)

    expect(posthog.config.persistence).toBe('localStorage+cookie')
    expect(posthog.config.autocapture).toBe(true)
    expect(posthog.config.disable_session_recording).toBe(false)
    client.identifyAnalyticsUser('user-1', 'tenant-1')
    await flush()
    expect(phStorageKeys(localStorage).length + phCookies().length).toBeGreaterThan(0)
  })
})

describe('withdrawing consent', () => {
  it('turns replay, autocapture and heatmaps off, returns to memory and clears what was stored', async () => {
    const client = await loadClient()
    const { posthog, sent } = await start(client, true)
    client.identifyAnalyticsUser('user-1', 'tenant-1')
    await flush()
    posthog.capture('$pageview')
    // Precondition: consent really did store something to clear.
    expect(phStorageKeys(localStorage).length + phCookies().length).toBeGreaterThan(0)
    const stopRecording = vi.spyOn(posthog, 'stopSessionRecording')

    await client.applyAnalyticsConsent(false)

    expect(stopRecording).toHaveBeenCalled()
    expect(posthog.config.disable_session_recording).toBe(true)
    expect(posthog.config.persistence).toBe('memory')
    expect(posthog.config.autocapture).toBe(false)
    expect(posthog.config.enable_heatmaps).toBe(false)
    expect(posthog.config.capture_pageview).toBe(false)
    expect(phCookies()).toEqual([])
    expect(phStorageKeys(localStorage)).toEqual([])
    expect(phStorageKeys(sessionStorage)).toEqual([])

    sent.length = 0
    posthog.capture('$pageview')
    client.track('onboarding_step_viewed', { step_index: 0, step_name: 'clinic' })
    await flush()
    expect(sent.map((e) => e.event)).toEqual(['onboarding_step_viewed'])
    expect(phStorageKeys(localStorage)).toEqual([])
  })
})

describe('sent properties', () => {
  it('strips query parameters but UTMs from URLs, masks ids in paths, and keeps only dictionary properties', async () => {
    window.history.replaceState(
      null,
      '',
      '/pacientes/3f2b8c1e-1a2b-4c3d-8e9f-0a1b2c3d4e5f?email=ana%40example.com&token=abc&utm_source=instagram',
    )
    const client = await loadClient()
    const { sent } = await start(client, false)

    client.track('signup_started', {
      method: 'email',
      utm_source: 'instagram',
      in_app_browser: false,
      // Not in the dictionary: must not be sent.
      ...({ email: 'ana@example.com', clinic_name: 'Clínica Ana' } as object),
    } as never)
    await flush()

    const [event] = sent
    expect(event.event).toBe('signup_started')
    expect(event.properties.$current_url).toBe('http://localhost:3000/pacientes/:id?utm_source=instagram')
    expect(event.properties.$pathname).toBe('/pacientes/:id')
    expect(event.properties).not.toHaveProperty('email')
    expect(event.properties).not.toHaveProperty('clinic_name')
    expect(event.properties).not.toHaveProperty('title')
    expect(JSON.stringify(event)).not.toContain('ana@example.com')
    expect(JSON.stringify(event)).not.toContain('token=abc')
    window.history.replaceState(null, '', '/')
  })
})

describe('without a key', () => {
  it('never loads posthog-js and every call is a no-op', async () => {
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', '')
    let loaded = false
    vi.resetModules()
    vi.doMock('posthog-js', () => {
      loaded = true
      return { default: {} }
    })
    const client = await import('../client')

    await expect(client.initAnalytics({ consentGranted: true })).resolves.toBeNull()
    client.track('signup_started', { method: 'google', in_app_browser: false })
    client.identifyAnalyticsUser('user-1', 'tenant-1')
    client.resetAnalytics()
    await client.applyAnalyticsConsent(true)

    expect(loaded).toBe(false)
    expect(vi.mocked(fetch)).not.toHaveBeenCalled()
    expect(phCookies()).toEqual([])
    expect(phStorageKeys(localStorage)).toEqual([])
    vi.doUnmock('posthog-js')
  })
})
