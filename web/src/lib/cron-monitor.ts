import * as Sentry from '@sentry/nextjs'

/**
 * Cron monitoring, kept out of `@/lib/observability` on purpose.
 *
 * `instrumentation-client.ts` imports `scrubEvent` from that module, which
 * pulls all of it into the client bundle, and `Sentry.withMonitor` only
 * exists in the server build of `@sentry/nextjs`. TypeScript cannot see the
 * difference because the published types union both builds, so the only
 * signal is the bundler failing at build time. Keeping the server-only
 * surface in its own module is what stops that from happening again.
 */

/**
 * Sentry cron monitor config for a Vercel cron.
 *
 * `schedule` must mirror the entry in `web/vercel.json`, and the timezone is
 * `Etc/UTC` because Vercel evaluates cron expressions in UTC: tell Sentry
 * anything else and it reports every run as late. `checkinMargin` and
 * `maxRuntime` are minutes, so a run has an hour of slack before it counts as
 * missed and ten minutes before it counts as hung.
 */
export function cronMonitorConfig(schedule: string) {
  return {
    schedule: { type: 'crontab', value: schedule },
    timezone: 'Etc/UTC',
    checkinMargin: 60,
    maxRuntime: 10,
  } as const
}

/**
 * How long to wait for queued Sentry events to reach the network before
 * giving up. Long enough for a check-in on a warm instance, short enough that
 * an unreachable Sentry cannot hold a cron response open.
 */
const SENTRY_FLUSH_TIMEOUT_MS = 2000

/**
 * Run a cron body under a Sentry monitor, and make sure the closing check-in
 * actually leaves the machine.
 *
 * `Sentry.withMonitor` alone is not enough on Vercel. It sends the opening
 * check-in before the work, so that one has the whole job to reach the
 * network and it arrives. The closing one is queued at the very end, and the
 * instance can freeze the moment the response is sent, so it never goes out.
 * Sentry then sees a run that started and never finished and reports a
 * timeout, which is indistinguishable from the cron genuinely hanging.
 *
 * That is not theoretical: both monitors added with the original
 * instrumentation went weeks without recording a single successful run, and
 * invoking `subscription-expiry` by hand reproduced it exactly. The job
 * returned ok in under three seconds and Sentry still only ever saw the
 * opening check-in.
 *
 * The flush is in a `finally` so a throwing job still reports its error
 * check-in rather than being swallowed into another phantom timeout.
 */
export async function withCronMonitor<T>(
  slug: string,
  schedule: string,
  body: () => Promise<T>,
): Promise<T> {
  try {
    return await Sentry.withMonitor(slug, body, cronMonitorConfig(schedule))
  } finally {
    await Sentry.flush(SENTRY_FLUSH_TIMEOUT_MS)
  }
}
