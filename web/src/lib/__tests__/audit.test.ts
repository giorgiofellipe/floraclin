import { describe, it, expect, vi, beforeEach } from 'vitest'
import '@/tests/mocks/db'

import { db } from '@/db/client'

describe('createAuditLog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Set up the chain: db.insert().values() should resolve
    const mockValues = vi.fn().mockResolvedValue(undefined)
    vi.mocked(db.insert).mockReturnValue({ values: mockValues } as never)
  })

  it('inserts correct data with all fields', async () => {
    const { createAuditLog } = await import('@/lib/audit')

    await createAuditLog({
      tenantId: 'tenant-1',
      userId: 'user-1',
      action: 'create',
      entityType: 'patient',
      entityId: 'patient-1',
      changes: { name: { old: 'A', new: 'B' } },
      ipAddress: '192.168.1.1',
      userAgent: 'Mozilla/5.0',
    })

    expect(db.insert).toHaveBeenCalledOnce()
    // Verify the values call received all the expected data
    const valuesCall = vi.mocked(db.insert).mock.results[0]?.value?.values
    expect(valuesCall).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      userId: 'user-1',
      action: 'create',
      entityType: 'patient',
      entityId: 'patient-1',
      changes: { name: { old: 'A', new: 'B' } },
      ipAddress: '192.168.1.1',
      userAgent: 'Mozilla/5.0',
    })
  })

  it('handles null tenantId for platform-level actions', async () => {
    const { createAuditLog } = await import('@/lib/audit')

    await createAuditLog({
      tenantId: null,
      userId: 'admin-user',
      action: 'login',
      entityType: 'session',
    })

    const valuesCall = vi.mocked(db.insert).mock.results[0]?.value?.values
    expect(valuesCall).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: null,
        userId: 'admin-user',
        action: 'login',
        entityType: 'session',
      })
    )
  })

  it('handles optional fields as undefined', async () => {
    const { createAuditLog } = await import('@/lib/audit')

    await createAuditLog({
      tenantId: 'tenant-1',
      userId: 'user-1',
      action: 'delete',
      entityType: 'patient',
    })

    const valuesCall = vi.mocked(db.insert).mock.results[0]?.value?.values
    expect(valuesCall).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-1',
        entityId: undefined,
        changes: undefined,
        ipAddress: undefined,
        userAgent: undefined,
      })
    )
  })
})
