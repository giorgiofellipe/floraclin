import { after } from 'next/server'
import type { EventMessage, PostHog } from 'posthog-node'
import { reportSideEffectFailure } from '@/lib/observability'
import { analyticsConfig } from './config'
import { pickEventProperties, type AnalyticsEventProperties, type ServerEventName } from './events'

/**
 * Server-side analytics: the funnel steps the server is the authority on
 * (account created, e-mail confirmed, signed in, onboarding saved, first
 * patient / photo / appointment).
 *
 * These do not read the cookie banner. They set no cookie and store nothing
 * on the device, carry internal ids only (user id as distinct id, tenant id as
 * the `tenant` group) and dictionary properties only, so they run on
 * legitimate interest (LGPD art. 7º IX / art. 10) like any first-party usage
 * log.
 *
 * Never throws into the request: the capture is scheduled with `after()` and
 * every failure is reported to Sentry and swallowed. With no PostHog key
 * configured nothing is scheduled, and posthog-node is never loaded.
 */

interface ServerEventTarget {
  /** Internal user id. */
  distinctId: string
  tenantId?: string | null
}

/**
 * A target, or a function that resolves one after the response (a lookup, or
 * an "is this the tenant's first?" check). Resolving to null skips the event.
 * The function only runs when analytics is configured.
 */
type ServerEventTargetInput = ServerEventTarget | (() => Promise<ServerEventTarget | null>)

let client: Promise<PostHog | null> | null = null

function getClient(): Promise<PostHog | null> {
  const config = analyticsConfig()
  if (!config) return Promise.resolve(null)
  // Serverless: send each event straight away rather than batching, and give
  // up quickly, since this runs inside the function's lifetime.
  client ??= import('posthog-node')
    .then(
      ({ PostHog }) =>
        new PostHog(config.key, { host: config.host, flushAt: 1, flushInterval: 0, requestTimeout: 3000, fetchRetryCount: 1 }),
    )
    .catch((error) => {
      // Let the next event try again instead of failing until a cold start.
      client = null
      throw error
    })
  return client
}

function buildServerEvent<E extends ServerEventName>(
  event: E,
  target: ServerEventTarget,
  properties: AnalyticsEventProperties[E],
): EventMessage {
  return {
    distinctId: target.distinctId,
    event,
    properties: pickEventProperties(event, properties),
    ...(target.tenantId ? { groups: { tenant: target.tenantId } } : {}),
  }
}

export function trackServerEvent<E extends ServerEventName>(
  event: E,
  target: ServerEventTargetInput,
  properties: AnalyticsEventProperties[E],
): void {
  if (!analyticsConfig()) return
  try {
    after(async () => {
      try {
        const resolved = typeof target === 'function' ? await target() : target
        if (!resolved) return
        const posthog = await getClient()
        if (!posthog) return
        posthog.capture(buildServerEvent(event, resolved, properties))
        await posthog.flush()
      } catch (error) {
        reportSideEffectFailure(error, { area: 'analytics', step: event })
      }
    })
  } catch (error) {
    // after() outside a request scope (a script, a test).
    reportSideEffectFailure(error, { area: 'analytics', step: event })
  }
}

/** Test-only: drop the cached client so a changed env is picked up. */
export function __resetAnalyticsServerForTests(): void {
  client = null
}
