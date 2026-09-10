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
    connectionType: 'connection_type',
    lastError: 'last_error',
    lastErrorAt: 'last_error_at',
  },
}))

import { db } from '@/db/client'
import { decryptSecret, encryptSecret, isEncryptedSecret } from '@/lib/crypto'
import {
  getMetaConnection,
  getMetaConnectionRaw,
  listActiveOAuthConnections,
  upsertMetaConnection,
  updateMetaConnectionSettings,
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

    // Safety-critical: a pending_dataset connection has no dataset to post to,
    // so every caller must read it as "no connection".
    it('returns null when the connection is still waiting for a dataset', async () => {
      const row = makeConnectionRow({ status: 'pending_dataset', datasetId: null })
      dbMock.select.mockReturnValue(makeChain([row]))

      const result = await getMetaConnection('tenant-1')

      expect(result).toBeNull()
    })

    it('returns null when an active row somehow has no dataset', async () => {
      const row = makeConnectionRow({ status: 'active', datasetId: null })
      dbMock.select.mockReturnValue(makeChain([row]))

      const result = await getMetaConnection('tenant-1')

      expect(result).toBeNull()
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

    // The settings card needs it to render the dataset picker.
    it('returns a pending_dataset connection so leg 2 can be rendered', async () => {
      const row = makeConnectionRow({ status: 'pending_dataset', datasetId: null })
      dbMock.select.mockReturnValue(makeChain([row]))

      const result = await getMetaConnectionRaw('tenant-1')

      expect(result).toEqual(row)
    })

    it('decrypts the stored token', async () => {
      const row = makeConnectionRow({ accessToken: encryptSecret('token-9') })
      dbMock.select.mockReturnValue(makeChain([row]))

      const result = await getMetaConnectionRaw('tenant-1')

      expect(result?.accessToken).toBe('token-9')
    })

    // Rows written before encryption shipped, and rows this deploy reaches
    // before the backfill does.
    it('returns a token that is still plaintext unchanged', async () => {
      const row = makeConnectionRow({ accessToken: 'EAABsbCS1iZAIBAO' })
      dbMock.select.mockReturnValue(makeChain([row]))

      const result = await getMetaConnectionRaw('tenant-1')

      expect(result?.accessToken).toBe('EAABsbCS1iZAIBAO')
    })
  })

  describe('listActiveOAuthConnections', () => {
    it('decrypts every token, so the ad-metadata backfill can authenticate', async () => {
      dbMock.select.mockReturnValue(
        makeChain([
          makeConnectionRow({ accessToken: encryptSecret('token-a') }),
          makeConnectionRow({ id: 'conn-2', accessToken: 'still-plaintext' }),
        ]),
      )

      const result = await listActiveOAuthConnections()

      expect(result.map((c) => c.accessToken)).toEqual(['token-a', 'still-plaintext'])
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

    it('parks an OAuth authorization as pending_dataset with no dataset', async () => {
      const chain = makeChain([makeConnectionRow({ status: 'pending_dataset', datasetId: null })])
      dbMock.insert.mockReturnValue(chain)

      await upsertMetaConnection('tenant-1', {
        datasetId: null,
        accessToken: 'token-2',
        connectionType: 'oauth',
        status: 'pending_dataset',
      })

      const valuesCall = (chain.values as ReturnType<typeof vi.fn>).mock.calls[0][0]
      expect(valuesCall.status).toBe('pending_dataset')
      expect(valuesCall.datasetId).toBeNull()
      const setCall = (chain.onConflictDoUpdate as ReturnType<typeof vi.fn>).mock.calls[0][0]
      expect(setCall.set.status).toBe('pending_dataset')
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

    it('encrypts the token on the way in and hands the caller plaintext back', async () => {
      const chain = makeChain([makeConnectionRow({ accessToken: 'stored-cipher' })])
      dbMock.insert.mockReturnValue(chain)

      const result = await upsertMetaConnection('tenant-1', {
        datasetId: 'dataset-2',
        accessToken: 'token-2',
        connectionType: 'manual',
      })

      const valuesCall = (chain.values as ReturnType<typeof vi.fn>).mock.calls[0][0]
      const setCall = (chain.onConflictDoUpdate as ReturnType<typeof vi.fn>).mock.calls[0][0]
      expect(valuesCall.accessToken).not.toBe('token-2')
      expect(isEncryptedSecret(valuesCall.accessToken)).toBe(true)
      expect(decryptSecret(valuesCall.accessToken)).toBe('token-2')
      expect(setCall.set.accessToken).toBe(valuesCall.accessToken)
      // A row still holding a plaintext token reads back unchanged, which is
      // what keeps the app working before the backfill runs.
      expect(result.accessToken).toBe('stored-cipher')
    })

    // A clinic that turned advanced matching off must not get it back on by
    // re-authorizing, and its test event code and business must survive too.
    it('leaves the settings the caller did not supply alone on conflict', async () => {
      const chain = makeChain([makeConnectionRow()])
      dbMock.insert.mockReturnValue(chain)

      await upsertMetaConnection('tenant-1', {
        datasetId: null,
        accessToken: 'token-2',
        connectionType: 'oauth',
        status: 'pending_dataset',
      })

      const setCall = (chain.onConflictDoUpdate as ReturnType<typeof vi.fn>).mock.calls[0][0]
      expect(setCall.set).not.toHaveProperty('advancedMatchingEnabled')
      expect(setCall.set).not.toHaveProperty('testEventCode')
      expect(setCall.set).not.toHaveProperty('businessId')
    })

    it('writes the settings the caller did supply, including a false one', async () => {
      const chain = makeChain([makeConnectionRow({ advancedMatchingEnabled: false })])
      dbMock.insert.mockReturnValue(chain)

      await upsertMetaConnection('tenant-1', {
        datasetId: 'dataset-2',
        accessToken: 'token-2',
        connectionType: 'manual',
        advancedMatchingEnabled: false,
        testEventCode: null,
        businessId: 'biz-1',
      })

      const setCall = (chain.onConflictDoUpdate as ReturnType<typeof vi.fn>).mock.calls[0][0]
      expect(setCall.set.advancedMatchingEnabled).toBe(false)
      expect(setCall.set.testEventCode).toBeNull()
      expect(setCall.set.businessId).toBe('biz-1')
    })

    // The expiry describes the token being written, so it must not survive
    // from whatever token the row held before.
    it('always rewrites tokenExpiresAt alongside the token', async () => {
      const chain = makeChain([makeConnectionRow()])
      dbMock.insert.mockReturnValue(chain)

      await upsertMetaConnection('tenant-1', {
        datasetId: 'dataset-2',
        accessToken: 'token-2',
        connectionType: 'manual',
      })

      const setCall = (chain.onConflictDoUpdate as ReturnType<typeof vi.fn>).mock.calls[0][0]
      expect(setCall.set.tokenExpiresAt).toBeNull()
    })
  })

  describe('updateMetaConnectionSettings', () => {
    it('leaves the status alone when the caller does not ask for one', async () => {
      const chain = makeChain([makeConnectionRow()])
      dbMock.update.mockReturnValue(chain)

      await updateMetaConnectionSettings('tenant-1', { datasetId: 'dataset-2' })

      const setCall = (chain.set as ReturnType<typeof vi.fn>).mock.calls[0][0]
      expect(setCall).not.toHaveProperty('status')
      expect(setCall.datasetId).toBe('dataset-2')
    })

    it('flips the connection to active when leg 2 saves a dataset', async () => {
      const chain = makeChain([makeConnectionRow({ datasetId: 'dataset-2' })])
      dbMock.update.mockReturnValue(chain)

      await updateMetaConnectionSettings('tenant-1', { datasetId: 'dataset-2', status: 'active' })

      const setCall = (chain.set as ReturnType<typeof vi.fn>).mock.calls[0][0]
      expect(setCall.status).toBe('active')
    })

    it('hands the caller a plaintext token back', async () => {
      const chain = makeChain([makeConnectionRow({ accessToken: encryptSecret('token-9') })])
      dbMock.update.mockReturnValue(chain)

      const result = await updateMetaConnectionSettings('tenant-1', { datasetId: 'dataset-2' })

      expect(result?.accessToken).toBe('token-9')
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
