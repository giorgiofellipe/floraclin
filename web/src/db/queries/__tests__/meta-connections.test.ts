import { describe, it, expect, vi, beforeEach } from 'vitest'

// A minimal thenable chain: every builder method (from/where/limit/values/
// onConflictDoUpdate/returning/set) returns the same chain instance, and the
// chain itself resolves to `result` however long the call chain is. This
// mirrors the drizzle query builder closely enough for these query
// functions, which never branch on intermediate return values.
function makeChain(result: unknown) {
  const chain: Record<string, unknown> = {}
  const passthrough = ['from', 'where', 'limit', 'values', 'onConflictDoUpdate', 'onConflictDoNothing', 'set', 'returning', 'orderBy']
  for (const method of passthrough) {
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
  db: {
    select: selectMock,
    insert: insertMock,
    update: updateMock,
    delete: deleteMock,
  },
}))

vi.mock('@/db/schema', () => ({
  metaConnections: {
    tenantId: 'tenant_id',
    status: 'status',
    lastError: 'last_error',
    lastErrorAt: 'last_error_at',
  },
}))

import { db } from '@/db/client'
import {
  getMetaConnection,
  getMetaConnectionRaw,
  upsertMetaConnection,
  markConnectionInvalid,
  markConnectionVerified,
  deleteMetaConnection,
  recordAcknowledgement,
} from '../meta-connections'

const dbMock = db as unknown as {
  select: typeof selectMock
  insert: typeof insertMock
  update: typeof updateMock
  delete: typeof deleteMock
}

function makeConnectionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'conn-1',
    tenantId: 'tenant-1',
    datasetId: 'dataset-1',
    accessToken: 'token-1',
    businessId: null,
    connectionType: 'manual',
    tokenExpiresAt: null,
    testEventCode: null,
    advancedMatchingEnabled: true,
    status: 'active',
    acknowledgedAt: null,
    acknowledgementVersion: null,
    acknowledgedBy: null,
    lastVerifiedAt: null,
    lastErrorAt: null,
    lastError: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  }
}

describe('meta-connections queries', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('getMetaConnection', () => {
    it('returns null when the connection status is disabled', async () => {
      const row = makeConnectionRow({ status: 'disabled' })
      dbMock.select.mockReturnValue(makeChain([row]))

      const result = await getMetaConnection('tenant-1')

      expect(result).toBeNull()
    })

    it('returns the connection when status is active', async () => {
      const row = makeConnectionRow({ status: 'active' })
      dbMock.select.mockReturnValue(makeChain([row]))

      const result = await getMetaConnection('tenant-1')

      expect(result).toEqual(row)
    })

    it('returns null when there is no row for the tenant', async () => {
      dbMock.select.mockReturnValue(makeChain([]))

      const result = await getMetaConnection('tenant-1')

      expect(result).toBeNull()
    })
  })

  describe('getMetaConnectionRaw', () => {
    it('returns a disabled connection unchanged', async () => {
      const row = makeConnectionRow({ status: 'disabled' })
      dbMock.select.mockReturnValue(makeChain([row]))

      const result = await getMetaConnectionRaw('tenant-1')

      expect(result).toEqual(row)
    })
  })

  describe('upsertMetaConnection', () => {
    it('resets status to active and clears lastError on conflict', async () => {
      const insertedRow = makeConnectionRow({ status: 'active', lastError: null, lastErrorAt: null })
      const chain = makeChain([insertedRow])
      dbMock.insert.mockReturnValue(chain)

      const result = await upsertMetaConnection('tenant-1', {
        datasetId: 'dataset-2',
        accessToken: 'token-2',
        connectionType: 'manual',
      })

      expect(result).toEqual(insertedRow)
      const setCall = (chain.onConflictDoUpdate as ReturnType<typeof vi.fn>).mock.calls[0][0]
      expect(setCall.set.status).toBe('active')
      expect(setCall.set.lastError).toBeNull()
      expect(setCall.set.lastErrorAt).toBeNull()
    })

    it('scopes the inserted row to the given tenant', async () => {
      const chain = makeChain([makeConnectionRow()])
      dbMock.insert.mockReturnValue(chain)

      await upsertMetaConnection('tenant-1', {
        datasetId: 'dataset-2',
        accessToken: 'token-2',
        connectionType: 'oauth',
      })

      const valuesCall = (chain.values as ReturnType<typeof vi.fn>).mock.calls[0][0]
      expect(valuesCall.tenantId).toBe('tenant-1')
    })
  })

  describe('markConnectionInvalid', () => {
    it('updates status and lastError instead of deleting the row', async () => {
      const chain = makeChain(undefined)
      dbMock.update.mockReturnValue(chain)

      await markConnectionInvalid('tenant-1', 'token expired')

      expect(dbMock.update).toHaveBeenCalled()
      expect(dbMock.delete).not.toHaveBeenCalled()
      const setCall = (chain.set as ReturnType<typeof vi.fn>).mock.calls[0][0]
      expect(setCall.status).toBe('invalid_token')
      expect(setCall.lastError).toBe('token expired')
      expect(setCall.lastErrorAt).toBeInstanceOf(Date)
    })
  })

  describe('markConnectionVerified', () => {
    it('updates lastVerifiedAt', async () => {
      const chain = makeChain(undefined)
      dbMock.update.mockReturnValue(chain)

      await markConnectionVerified('tenant-1')

      const setCall = (chain.set as ReturnType<typeof vi.fn>).mock.calls[0][0]
      expect(setCall.lastVerifiedAt).toBeInstanceOf(Date)
    })
  })

  describe('deleteMetaConnection', () => {
    it('deletes the row scoped to the tenant', async () => {
      const chain = makeChain(undefined)
      dbMock.delete.mockReturnValue(chain)

      await deleteMetaConnection('tenant-1')

      expect(dbMock.delete).toHaveBeenCalled()
    })
  })

  describe('recordAcknowledgement', () => {
    it('sets acknowledgedBy, acknowledgementVersion and acknowledgedAt', async () => {
      const chain = makeChain(undefined)
      dbMock.update.mockReturnValue(chain)

      await recordAcknowledgement('tenant-1', 'user-1', 'v1')

      const setCall = (chain.set as ReturnType<typeof vi.fn>).mock.calls[0][0]
      expect(setCall.acknowledgedBy).toBe('user-1')
      expect(setCall.acknowledgementVersion).toBe('v1')
      expect(setCall.acknowledgedAt).toBeInstanceOf(Date)
    })
  })
})
