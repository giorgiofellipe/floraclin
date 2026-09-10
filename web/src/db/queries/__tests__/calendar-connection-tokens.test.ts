import { describe, it, expect, vi, beforeEach } from 'vitest'

// A minimal thenable chain, as in meta-connections.test.ts: every builder
// method returns the same instance and the chain resolves to `result`.
function makeChain(result: unknown) {
  const chain: Record<string, unknown> = {}
  for (const method of ['from', 'where', 'limit', 'values', 'set', 'returning']) {
    chain[method] = vi.fn(() => chain)
  }
  chain.then = (resolve: (value: unknown) => void) => resolve(result)
  return chain
}

const { selectMock, insertMock, updateMock, deleteMock } = vi.hoisted(() => ({
  selectMock: vi.fn(),
  insertMock: vi.fn(),
  updateMock: vi.fn(),
  deleteMock: vi.fn(),
}))

vi.mock('@/db/client', () => ({
  db: { select: selectMock, insert: insertMock, update: updateMock, delete: deleteMock },
}))

vi.mock('@/db/schema', () => ({
  calendarConnections: { id: 'id', tenantId: 'tenant_id', userId: 'user_id', channelId: 'channel_id', feedToken: 'feed_token', enabled: 'enabled', channelExpiry: 'channel_expiry' },
  calendarBlocks: {},
  appointments: {},
  users: {},
}))

import { db } from '@/db/client'
import { decryptSecret, encryptSecret, isEncryptedSecret } from '@/lib/crypto'
import {
  getConnectionById,
  getConnectionByChannelId,
  upsertConnection,
  updateConnection,
  deleteConnection,
} from '../calendar'

const dbMock = db as unknown as {
  select: typeof selectMock
  insert: typeof insertMock
  update: typeof updateMock
  delete: typeof deleteMock
}

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'conn-1',
    tenantId: 'tenant-1',
    userId: 'user-1',
    provider: 'google',
    accessToken: encryptSecret('at-stored'),
    refreshToken: encryptSecret('rt-stored'),
    tokenExpiresAt: new Date('2026-01-01T00:00:00Z'),
    calendarId: 'primary',
    syncToken: null,
    channelId: null,
    channelResourceId: null,
    channelExpiry: null,
    feedToken: 'feed-1',
    enabled: true,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  }
}

describe('calendar connection tokens', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('decrypts both tokens on read', async () => {
    dbMock.select.mockReturnValue(makeChain([makeRow()]))

    const result = await getConnectionById('conn-1')

    expect(result?.accessToken).toBe('at-stored')
    expect(result?.refreshToken).toBe('rt-stored')
  })

  // Rows written before encryption shipped, and rows this deploy reaches
  // before the backfill does. Without the pass-through every existing Google
  // Calendar connection would break.
  it('returns tokens that are still plaintext unchanged', async () => {
    const row = makeRow({ accessToken: 'ya29.plain', refreshToken: '1//04plain' })
    dbMock.select.mockReturnValue(makeChain([row]))

    const result = await getConnectionByChannelId('chan-1')

    expect(result?.accessToken).toBe('ya29.plain')
    expect(result?.refreshToken).toBe('1//04plain')
  })

  it('encrypts both tokens when inserting a new connection', async () => {
    dbMock.select.mockReturnValue(makeChain([]))
    const chain = makeChain([makeRow()])
    dbMock.insert.mockReturnValue(chain)

    const result = await upsertConnection({
      tenantId: 'tenant-1',
      userId: 'user-1',
      accessToken: 'at-new',
      refreshToken: 'rt-new',
      tokenExpiresAt: new Date('2026-02-01T00:00:00Z'),
      feedToken: 'feed-1',
    })

    const values = (chain.values as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(isEncryptedSecret(values.accessToken)).toBe(true)
    expect(decryptSecret(values.accessToken)).toBe('at-new')
    expect(decryptSecret(values.refreshToken)).toBe('rt-new')
    // The caller keeps handling plaintext.
    expect(result.accessToken).toBe('at-stored')
  })

  it('encrypts both tokens when replacing an existing connection', async () => {
    dbMock.select.mockReturnValue(makeChain([{ id: 'conn-1', feedToken: 'feed-1' }]))
    const chain = makeChain([makeRow()])
    dbMock.update.mockReturnValue(chain)

    await upsertConnection({
      tenantId: 'tenant-1',
      userId: 'user-1',
      accessToken: 'at-new',
      refreshToken: 'rt-new',
      tokenExpiresAt: new Date('2026-02-01T00:00:00Z'),
      feedToken: 'feed-1',
    })

    const set = (chain.set as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(decryptSecret(set.accessToken)).toBe('at-new')
    expect(decryptSecret(set.refreshToken)).toBe('rt-new')
  })

  // The token refresh in getGoogleCalendarClient goes through here.
  it('encrypts a refreshed token and leaves other columns alone', async () => {
    const chain = makeChain([makeRow()])
    dbMock.update.mockReturnValue(chain)

    await updateConnection('conn-1', 'tenant-1', {
      accessToken: 'at-refreshed',
      refreshToken: 'rt-refreshed',
      tokenExpiresAt: new Date('2026-03-01T00:00:00Z'),
    })

    const set = (chain.set as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(decryptSecret(set.accessToken)).toBe('at-refreshed')
    expect(decryptSecret(set.refreshToken)).toBe('rt-refreshed')
  })

  it('does not invent token columns on an update that has none', async () => {
    const chain = makeChain([makeRow()])
    dbMock.update.mockReturnValue(chain)

    await updateConnection('conn-1', 'tenant-1', { enabled: false })

    const set = (chain.set as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(set).not.toHaveProperty('accessToken')
    expect(set).not.toHaveProperty('refreshToken')
  })

  // The DELETE route revokes the token on Google's side with this value.
  it('hands the deleted row back with plaintext tokens', async () => {
    dbMock.delete.mockReturnValue(makeChain([makeRow()]))

    const result = await deleteConnection('conn-1', 'tenant-1')

    expect(result?.accessToken).toBe('at-stored')
  })
})
