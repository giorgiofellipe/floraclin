import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/server', async () => {
  const actual = await vi.importActual<typeof import('next/server')>('next/server')
  return { ...actual, after: vi.fn() }
})

vi.mock('@/db/queries/calendar', () => ({
  getConnectionByChannelId: vi.fn(),
}))

vi.mock('@/lib/google-calendar-pull', () => ({
  incrementalSync: vi.fn(),
}))

vi.mock('@/lib/google-calendar', () => ({
  reportCalendarFailure: vi.fn(),
}))

import { after } from 'next/server'
import { getConnectionByChannelId } from '@/db/queries/calendar'
import { incrementalSync } from '@/lib/google-calendar-pull'
import { reportCalendarFailure } from '@/lib/google-calendar'
import { POST } from '../route'

const CONNECTION = {
  id: 'conn-1',
  enabled: true,
  channelResourceId: 'resource-1',
}

function post(headers: Record<string, string>) {
  return POST(new Request('http://localhost/api/calendar/webhook', { method: 'POST', headers }))
}

function notification(overrides: Record<string, string> = {}) {
  return post({
    'x-goog-channel-id': 'channel-1',
    'x-goog-resource-id': 'resource-1',
    'x-goog-resource-state': 'exists',
    ...overrides,
  })
}

async function runScheduledWork() {
  const scheduled = vi.mocked(after).mock.calls.map(([task]) => task as () => Promise<void>)
  for (const task of scheduled) await task()
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getConnectionByChannelId).mockResolvedValue(CONNECTION as never)
  vi.mocked(incrementalSync).mockResolvedValue(undefined)
})

describe('POST /api/calendar/webhook', () => {
  it('answers 200 immediately and runs the sync after the response', async () => {
    const res = await notification()

    expect(res.status).toBe(200)
    expect(incrementalSync).not.toHaveBeenCalled()
    expect(after).toHaveBeenCalledTimes(1)

    await runScheduledWork()

    expect(incrementalSync).toHaveBeenCalledWith('conn-1')
    expect(reportCalendarFailure).not.toHaveBeenCalled()
  })

  it('reports a failed sync instead of throwing out of the scheduled task', async () => {
    const failure = new Error('Google down')
    vi.mocked(incrementalSync).mockRejectedValue(failure)

    const res = await notification()
    expect(res.status).toBe(200)

    await expect(runScheduledWork()).resolves.toBeUndefined()
    expect(reportCalendarFailure).toHaveBeenCalledWith(failure, 'incremental_sync', { connectionId: 'conn-1' })
  })

  it('ignores the initial sync handshake', async () => {
    const res = await notification({ 'x-goog-resource-state': 'sync' })

    expect(res.status).toBe(200)
    expect(getConnectionByChannelId).not.toHaveBeenCalled()
    expect(after).not.toHaveBeenCalled()
  })

  it('refuses an unknown channel, a resource mismatch, and a disabled connection without scheduling work', async () => {
    vi.mocked(getConnectionByChannelId).mockResolvedValueOnce(null as never)
    expect((await notification()).status).toBe(404)

    expect((await notification({ 'x-goog-resource-id': 'other' })).status).toBe(403)

    vi.mocked(getConnectionByChannelId).mockResolvedValueOnce({ ...CONNECTION, enabled: false } as never)
    expect((await notification()).status).toBe(200)

    expect(after).not.toHaveBeenCalled()
    expect(incrementalSync).not.toHaveBeenCalled()
  })
})
