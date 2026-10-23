/**
 * Server events: what reaches posthog-node, and that nothing reaches it (or
 * even loads it) without a key. posthog-node is replaced at the module
 * boundary and `after()` runs its callback inline.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { captured, afterCallbacks, constructed, reportSideEffectFailure, afterScope } = vi.hoisted(() => ({
  afterScope: { inRequest: true },
  captured: [] as unknown[],
  afterCallbacks: [] as Promise<unknown>[],
  constructed: [] as { key: string; options: Record<string, unknown> }[],
  reportSideEffectFailure: vi.fn(),
}))

vi.mock('next/server', () => ({
  after: (callback: () => Promise<unknown>) => {
    if (!afterScope.inRequest) throw new Error('`after` was called outside a request scope')
    afterCallbacks.push(callback())
  },
}))

vi.mock('posthog-node', () => ({
  PostHog: class {
    constructor(key: string, options: Record<string, unknown>) {
      constructed.push({ key, options })
    }
    capture(message: unknown) {
      captured.push(message)
    }
    async flush() {}
  },
}))

vi.mock('@/lib/observability', () => ({ reportSideEffectFailure }))

import { __resetAnalyticsServerForTests, trackServerEvent } from '../server'

async function settle() {
  await Promise.all(afterCallbacks.splice(0))
}

beforeEach(() => {
  captured.length = 0
  constructed.length = 0
  reportSideEffectFailure.mockClear()
  afterScope.inRequest = true
  __resetAnalyticsServerForTests()
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('without a key', () => {
  it('schedules nothing, constructs no client and never runs the lookup', async () => {
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', '')
    vi.stubEnv('POSTHOG_KEY', '')
    const lookup = vi.fn(async () => ({ distinctId: 'user-1' }))

    trackServerEvent('first_patient_created', lookup, {})
    trackServerEvent('login_succeeded', { distinctId: 'user-1' }, { method: 'email', is_new_user: false })
    await settle()

    expect(afterCallbacks).toEqual([])
    expect(lookup).not.toHaveBeenCalled()
    expect(constructed).toEqual([])
    expect(captured).toEqual([])
  })
})

describe('with a key', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', 'phc_public')
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_HOST', '')
  })

  it('sends an identified event by user id, grouped by tenant, with dictionary properties only', async () => {
    trackServerEvent('signup_completed', { distinctId: 'user-1', tenantId: 'tenant-1' }, {
      method: 'email',
      utm_source: 'instagram',
      // What a careless caller might add: never sent.
      ...({ email: 'ana@example.com', fullName: 'Ana Souza', clinicName: 'Clínica Ana', phone: '11999999999' } as object),
    } as never)
    await settle()

    expect(captured).toEqual([
      {
        distinctId: 'user-1',
        event: 'signup_completed',
        properties: { method: 'email', utm_source: 'instagram' },
        groups: { tenant: 'tenant-1' },
      },
    ])
  })

  it('sends anonymous events with a throwaway id and no person profile', async () => {
    trackServerEvent('email_confirmed', { distinctId: null }, {})
    trackServerEvent('email_confirmed', {}, {})
    await settle()

    const [first, second] = captured as { distinctId: string; properties: Record<string, unknown>; groups?: unknown }[]
    expect(first.properties.$process_person_profile).toBe(false)
    expect(second.properties.$process_person_profile).toBe(false)
    expect(first.distinctId).toMatch(/^[0-9a-f-]{36}$/)
    expect(first.distinctId).not.toBe(second.distinctId)
    expect(first.groups).toBeUndefined()
  })

  it('identified events leave person processing on', async () => {
    trackServerEvent('onboarding_completed', { distinctId: 'user-1', tenantId: 'tenant-1' }, {
      procedure_types_count: 3,
      products_count: 2,
    })
    await settle()

    expect((captured[0] as { properties: Record<string, unknown> }).properties).not.toHaveProperty('$process_person_profile')
  })

  it('skips the event when the lookup resolves to null (not the tenant’s first)', async () => {
    trackServerEvent('first_appointment_created', async () => null, {})
    await settle()
    expect(captured).toEqual([])
  })

  it('uses the EU host by default and sends each event straight away', async () => {
    trackServerEvent('email_confirmed', { distinctId: 'user-1' }, {})
    await settle()
    expect(constructed).toEqual([
      { key: 'phc_public', options: expect.objectContaining({ host: 'https://eu.i.posthog.com', flushAt: 1, flushInterval: 0 }) },
    ])
  })

  it('prefers the server-only POSTHOG_KEY when set', async () => {
    vi.stubEnv('POSTHOG_KEY', 'phc_server')
    trackServerEvent('email_confirmed', { distinctId: 'user-1' }, {})
    await settle()
    expect(constructed[0].key).toBe('phc_server')
  })

  it('never throws into the request: a failing lookup is reported and swallowed', async () => {
    const failure = new Error('db down')
    expect(() =>
      trackServerEvent('first_patient_created', async () => {
        throw failure
      }, {}),
    ).not.toThrow()
    await expect(settle()).resolves.toBeUndefined()
    expect(reportSideEffectFailure).toHaveBeenCalledWith(failure, { area: 'analytics', step: 'first_patient_created' })
  })

  it('never throws outside a request scope either (a script, a cron)', () => {
    afterScope.inRequest = false
    expect(() => trackServerEvent('email_confirmed', { distinctId: 'user-1' }, {})).not.toThrow()
    expect(reportSideEffectFailure).toHaveBeenCalledWith(expect.any(Error), { area: 'analytics', step: 'email_confirmed' })
  })
})
