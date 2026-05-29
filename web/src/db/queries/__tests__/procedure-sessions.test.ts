import { describe, expect, it, beforeEach } from 'vitest'
import { db } from '@/db/client'
import { procedureSessions } from '@/db/schema'
import {
  countSessionsForRecord,
  createSession,
  getSessionByOrdinal,
  listSessionsForAtendimento,
  listSessionsForRecord,
} from '../procedure-sessions'

const tenantId = '00000000-0000-0000-0000-000000000001'

describe('procedure-sessions queries', () => {
  beforeEach(async () => {
    await db.delete(procedureSessions)
  })

  it('createSession assigns the next ordinal for the record', async () => {
    const recordId = '00000000-0000-0000-0000-00000000aaaa'
    const userId = '00000000-0000-0000-0000-00000000bbbb'
    const first = await createSession({
      tenantId,
      procedureRecordId: recordId,
      executedBy: userId,
      performedAt: new Date('2026-05-01T12:00:00Z'),
    })
    const second = await createSession({
      tenantId,
      procedureRecordId: recordId,
      executedBy: userId,
      performedAt: new Date('2026-05-08T12:00:00Z'),
    })
    expect(first.sessionOrdinal).toBe(1)
    expect(second.sessionOrdinal).toBe(2)
  })

  it('countSessionsForRecord returns 0 with no sessions', async () => {
    expect(await countSessionsForRecord('00000000-0000-0000-0000-00000000cccc')).toBe(0)
  })

  it('listSessionsForRecord returns sessions ordered by ordinal', async () => {
    const recordId = '00000000-0000-0000-0000-00000000dddd'
    const userId = '00000000-0000-0000-0000-00000000bbbb'
    await createSession({
      tenantId,
      procedureRecordId: recordId,
      executedBy: userId,
      performedAt: new Date('2026-05-01T12:00:00Z'),
    })
    await createSession({
      tenantId,
      procedureRecordId: recordId,
      executedBy: userId,
      performedAt: new Date('2026-05-08T12:00:00Z'),
    })
    const sessions = await listSessionsForRecord(recordId)
    expect(sessions).toHaveLength(2)
    expect(sessions[0].sessionOrdinal).toBe(1)
    expect(sessions[1].sessionOrdinal).toBe(2)
  })

  it('getSessionByOrdinal returns the matching session or null', async () => {
    const recordId = '00000000-0000-0000-0000-00000000eeee'
    const userId = '00000000-0000-0000-0000-00000000bbbb'
    await createSession({
      tenantId,
      procedureRecordId: recordId,
      executedBy: userId,
      performedAt: new Date('2026-05-01T12:00:00Z'),
    })
    const found = await getSessionByOrdinal(recordId, 1)
    expect(found).not.toBeNull()
    expect(found?.sessionOrdinal).toBe(1)
    const missing = await getSessionByOrdinal(recordId, 99)
    expect(missing).toBeNull()
  })

  it('listSessionsForAtendimento returns [] when no records exist', async () => {
    const result = await listSessionsForAtendimento(
      '00000000-0000-0000-0000-00000000ffff',
    )
    expect(result).toEqual([])
  })

  it('createSession with expectedOrdinal matches MAX+1 and inserts', async () => {
    const recordId = '00000000-0000-0000-0000-000000001111'
    const userId = '00000000-0000-0000-0000-00000000bbbb'
    const first = await createSession({
      tenantId,
      procedureRecordId: recordId,
      executedBy: userId,
      performedAt: new Date('2026-05-01T12:00:00Z'),
      expectedOrdinal: 1,
    })
    expect(first.sessionOrdinal).toBe(1)

    const second = await createSession({
      tenantId,
      procedureRecordId: recordId,
      executedBy: userId,
      performedAt: new Date('2026-05-08T12:00:00Z'),
      expectedOrdinal: 2,
    })
    expect(second.sessionOrdinal).toBe(2)
  })

  it('createSession throws concurrent_session_insert when expectedOrdinal mismatches', async () => {
    const recordId = '00000000-0000-0000-0000-000000002222'
    const userId = '00000000-0000-0000-0000-00000000bbbb'
    await createSession({
      tenantId,
      procedureRecordId: recordId,
      executedBy: userId,
      performedAt: new Date('2026-05-01T12:00:00Z'),
    })
    // First session inserted at ordinal 1 → MAX+1 is 2. Asking for 5 should throw.
    await expect(
      createSession({
        tenantId,
        procedureRecordId: recordId,
        executedBy: userId,
        performedAt: new Date('2026-05-08T12:00:00Z'),
        expectedOrdinal: 5,
      }),
    ).rejects.toThrow('concurrent_session_insert')
  })
})
