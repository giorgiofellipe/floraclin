import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The bug this guards: `Sentry.withMonitor` alone loses the closing check-in
 * on Vercel. The opening one is sent before the work and has the whole job to
 * reach the network; the closing one is queued at the very end and the
 * instance can freeze the moment the response is sent. Sentry then reports a
 * timeout for a job that finished in under three seconds.
 *
 * Both monitors added with the original instrumentation went weeks without a
 * single successful run because of this, so the flush is the point of the
 * helper, not an incidental detail.
 */

const withMonitorMock = vi.fn()
const flushMock = vi.fn()

vi.mock('@sentry/nextjs', () => ({
  withMonitor: (...args: unknown[]) => withMonitorMock(...args),
  flush: (...args: unknown[]) => flushMock(...args),
  captureException: vi.fn(),
}))

import { withCronMonitor } from '@/lib/cron-monitor'

beforeEach(() => {
  vi.clearAllMocks()
  // Stand in for the real withMonitor: run the body, return its value.
  withMonitorMock.mockImplementation(async (_slug, body) => body())
  flushMock.mockResolvedValue(true)
})

describe('withCronMonitor', () => {
  it('flushes after a successful run, so the closing check-in leaves the machine', async () => {
    const result = await withCronMonitor('subscription-expiry', '0 3 * * *', async () => 7)

    expect(result).toBe(7)
    expect(flushMock).toHaveBeenCalledTimes(1)
  })

  it('flushes when the job throws, so the error check-in is not lost too', async () => {
    // Without the finally, a failing cron reports nothing and then gets a
    // phantom timeout ten minutes later, which reads as a hang rather than
    // the failure it actually was.
    const boom = new Error('renewal failed')

    await expect(
      withCronMonitor('calendar-renew', '0 6 * * *', async () => {
        throw boom
      }),
    ).rejects.toThrow(boom)

    expect(flushMock).toHaveBeenCalledTimes(1)
  })

  it('flushes only after the job has finished', async () => {
    const order: string[] = []

    await withCronMonitor('whatsapp-automations', '0 11 * * *', async () => {
      order.push('job')
      return null
    })
    flushMock.mock.calls.forEach(() => order.push('flush'))

    expect(order).toEqual(['job', 'flush'])
  })

  it('passes the schedule through to the monitor config', async () => {
    // A schedule that disagrees with vercel.json makes Sentry report every
    // run as late, which is its own kind of false alarm.
    await withCronMonitor('subscription-expiry', '0 3 * * *', async () => null)

    const [slug, , config] = withMonitorMock.mock.calls[0]
    expect(slug).toBe('subscription-expiry')
    expect(config).toMatchObject({
      schedule: { type: 'crontab', value: '0 3 * * *' },
      timezone: 'Etc/UTC',
    })
  })

  it('bounds the flush so an unreachable Sentry cannot hold the response open', async () => {
    await withCronMonitor('subscription-expiry', '0 3 * * *', async () => null)

    const [timeout] = flushMock.mock.calls[0]
    expect(typeof timeout).toBe('number')
    expect(timeout).toBeGreaterThan(0)
    expect(timeout).toBeLessThanOrEqual(5000)
  })
})
