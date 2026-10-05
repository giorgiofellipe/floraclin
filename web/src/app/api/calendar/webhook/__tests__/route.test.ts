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
} as NonNullable<Awaited<ReturnType<typeof getConnectionByChannelId>>>

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
  for (const [task] of vi.mocked(after).mock.calls) {
    await (typeof task === 'function' ? task() : task)
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getConnectionByChannelId).mockResolvedValue(CONNECTION)
  vi.mocked(incrementalSync).mockResolvedValue(undefined)
})

describe('POST /api/calendar/webhook', () => {
  it('answers 200 without awaiting the sync and registers it with after()', async () => {
    const res = await notification()

    expect(res.status).toBe(200)
    expect(incrementalSync).not.toHaveBeenCalled()
    expect(after).toHaveBeenCalledTimes(1)

    await runScheduledWork()

    expect(incrementalSync).toHaveBeenCalledWith('conn-1')
    expect(reportCalendarFailure).not.toHaveBeenCalled()
  })

  it('reports a failed sync from inside the scheduled task', async () => {
    const failure = new Error('Google down')
    vi.mocked(incrementalSync).mockRejectedValue(failure)

    const res = await notification()
    expect(res.status).toBe(200)
    expect(after).toHaveBeenCalledTimes(1)

    await expect(runScheduledWork()).resolves.toBeUndefined()
    expect(reportCalendarFailure).toHaveBeenCalledWith(failure, 'incremental_sync', { connectionId: 'conn-1' })
  })

  it('ignores the initial sync handshake', async () => {
    const res = await notification({ 'x-goog-resource-state': 'sync' })

    expect(res.status).toBe(200)
    expect(getConnectionByChannelId).not.toHaveBeenCalled()
    expect(after).not.toHaveBeenCalled()
  })

  it('answers 400 when the channel headers are missing', async () => {
    const res = await post({ 'x-goog-resource-state': 'exists' })

    expect(res.status).toBe(400)
    expect(after).not.toHaveBeenCalled()
  })

  it('answers 404 for an unknown channel', async () => {
    vi.mocked(getConnectionByChannelId).mockResolvedValue(null)

    expect((await notification()).status).toBe(404)
    expect(after).not.toHaveBeenCalled()
  })

  it('answers 403 when the resource id does not match the channel', async () => {
    expect((await notification({ 'x-goog-resource-id': 'other' })).status).toBe(403)
    expect(after).not.toHaveBeenCalled()
  })

  it('acknowledges a disabled connection without syncing', async () => {
    vi.mocked(getConnectionByChannelId).mockResolvedValue({ ...CONNECTION, enabled: false })

    expect((await notification()).status).toBe(200)
    expect(after).not.toHaveBeenCalled()
  })
})
