import { beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient } from '@tanstack/react-query'

import {
  countPendingSessions,
  encounterViewQueryOptions,
  EncounterViewNotFoundError,
  type EncounterView,
} from '../encounter-view'

const fetchMock = vi.fn()

beforeEach(() => {
  fetchMock.mockReset()
  global.fetch = fetchMock as unknown as typeof fetch
})

const jsonResponse = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

const fetchEncounterView = () =>
  new QueryClient({ defaultOptions: { queries: { retry: 3, retryDelay: 0 } } }).fetchQuery(
    encounterViewQueryOptions('enc-1'),
  )

describe('encounterViewQueryOptions', () => {
  it('fails with EncounterViewNotFoundError on 404 without retrying', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: false, error: 'Not found' }, 404))

    await expect(fetchEncounterView()).rejects.toBeInstanceOf(EncounterViewNotFoundError)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('does not report a server error as not found', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: false, error: 'boom' }, 500))

    const error = await fetchEncounterView().catch((e: unknown) => e)
    expect(error).toBeInstanceOf(Error)
    expect(error).not.toBeInstanceOf(EncounterViewNotFoundError)
  })
})

describe('countPendingSessions', () => {
  const records: EncounterView['records'] = [
    { id: 'rec-1', procedureTypeName: 'Botox', sessionsTotal: 3, sessions: [] },
    {
      id: 'rec-2',
      procedureTypeName: 'Bioestimulador',
      sessionsTotal: 2,
      sessions: [
        { id: 's-1', sessionOrdinal: 1, performedAt: '2026-10-01T12:00:00Z', executedByName: 'Dra. A' },
      ],
    },
  ]
  const pkg = (status: string, closedAt: string | null) => ({
    id: 'pkg-1',
    name: 'Pacote',
    expiresAt: null,
    status,
    closedAt,
    closedReason: null,
  })

  it.each([
    ['no package', null, 4],
    ['active package', pkg('active', null), 4],
    ['completed package', pkg('completed', null), 0],
    ['package closed early', pkg('active', '2026-10-01T12:00:00Z'), 0],
  ])('%s', (_label, packageRow, expected) => {
    expect(countPendingSessions({ records, package: packageRow })).toBe(expected)
  })
})
