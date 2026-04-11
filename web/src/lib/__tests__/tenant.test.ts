import { describe, it, expect, vi, beforeEach } from 'vitest'
import '@/tests/mocks/db'

// Must import after mock is set up
import { db } from '@/db/client'

describe('tenant helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('withTenant', () => {
    it('passes tenantId to callback and returns its result', async () => {
      // Dynamic import so mock is active
      const { withTenant } = await import('@/lib/tenant')

      const callback = vi.fn().mockResolvedValue([{ id: '1', name: 'Patient' }])
      const result = await withTenant('tenant-123', callback)

      expect(callback).toHaveBeenCalledWith('tenant-123')
      expect(result).toEqual([{ id: '1', name: 'Patient' }])
    })

    it('propagates errors from callback', async () => {
      const { withTenant } = await import('@/lib/tenant')

      const callback = vi.fn().mockRejectedValue(new Error('DB error'))
      await expect(withTenant('tenant-123', callback)).rejects.toThrow('DB error')
    })
  })

  describe('withTransaction', () => {
    it('wraps callback in db.transaction', async () => {
      const { withTransaction } = await import('@/lib/tenant')

      const callback = vi.fn().mockResolvedValue('tx-result')
      const mockTransaction = vi.mocked(db.transaction)
      mockTransaction.mockImplementation(async (fn) => fn({} as never))

      await withTransaction(callback)

      expect(db.transaction).toHaveBeenCalledOnce()
      expect(callback).toHaveBeenCalledOnce()
    })

    it('passes the transaction object to the callback', async () => {
      const { withTransaction } = await import('@/lib/tenant')

      const fakeTx = { insert: vi.fn() }
      const mockTransaction = vi.mocked(db.transaction)
      mockTransaction.mockImplementation(async (fn) => fn(fakeTx as never))

      let receivedTx: unknown
      await withTransaction(async (tx) => {
        receivedTx = tx
        return 'done'
      })

      expect(receivedTx).toBeDefined()
    })
  })
})
