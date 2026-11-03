import { describe, it, expect, vi, beforeEach } from 'vitest'
import { routedTx, tableOf, type LoggedQuery } from '@/tests/mocks/drizzle-tx'
import { faceDiagramGroups, procedureFollowups } from '@/db/schema'

const dbMock = { transaction: vi.fn() }
vi.mock('@/db/client', () => ({ db: dbMock }))

vi.mock('@/lib/tenant', async () => {
  const { db } = await import('@/db/client')
  return { withTransaction: (fn: (tx: unknown) => unknown) => db.transaction(fn as never) }
})

const auditMock = vi.fn()
vi.mock('@/lib/audit', () => ({ createAuditLog: (...args: unknown[]) => auditMock(...args) }))

vi.mock('@/db/queries/financial', () => ({ cancelLinkedFinancials: vi.fn() }))

const lockDiagramGroupMock = vi.fn()
vi.mock('@/db/queries/face-diagram-groups', () => ({
  lockDiagramGroup: (...args: unknown[]) => lockDiagramGroupMock(...args),
  releaseStandaloneGroups: vi.fn(),
}))

const TENANT = 'tenant-1'

function useTx(resolve: (q: LoggedQuery) => unknown) {
  const { tx, log } = routedTx(resolve)
  dbMock.transaction.mockImplementationOnce(async (cb: (tx: unknown) => unknown) => cb(tx))
  return { tx, log }
}

describe('recordDiagramFollowup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const args = {
    tenantId: TENANT,
    groupId: 'group-1',
    userId: 'user-1',
    channel: 'call' as const,
    outcome: 'desistiu' as const,
    notes: null,
  }

  it('declines the quotation on desistiu, linking the followup to the group', async () => {
    const { recordDiagramFollowup } = await import('../followups')
    lockDiagramGroupMock.mockResolvedValue({ id: 'group-1', status: 'quote' })
    const { tx, log } = useTx((q) => (q.op === 'insert' ? [{ id: 'followup-1' }] : undefined))

    const result = await recordDiagramFollowup(args)

    expect(result).toEqual({ followupId: 'followup-1', declined: true })
    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({ entityType: 'procedure_followup', entityId: 'followup-1', userId: 'user-1' }),
      tx,
    )
    const insert = log.find((q) => tableOf(q) === procedureFollowups)!
    expect(insert.capture.value).toMatchObject({
      tenantId: TENANT,
      faceDiagramGroupId: 'group-1',
      contactedBy: 'user-1',
      outcome: 'desistiu',
    })
    const update = log.find((q) => tableOf(q) === faceDiagramGroups)!
    expect(update.capture.value).toMatchObject({
      lastContactedAt: expect.any(Date),
      declinedAt: expect.any(Date),
    })
  })

  it('only stamps the last contact for other outcomes', async () => {
    const { recordDiagramFollowup } = await import('../followups')
    lockDiagramGroupMock.mockResolvedValue({ id: 'group-1', status: 'quote' })
    const { log } = useTx((q) => (q.op === 'insert' ? [{ id: 'followup-1' }] : undefined))

    const result = await recordDiagramFollowup({ ...args, outcome: 'sem_resposta' })

    expect(result.declined).toBe(false)
    const update = log.find((q) => tableOf(q) === faceDiagramGroups)!
    expect(update.capture.value).toMatchObject({ lastContactedAt: expect.any(Date) })
    expect(update.capture.value).not.toHaveProperty('declinedAt')
  })

  it('throws and writes nothing when the quotation already moved into an atendimento', async () => {
    const { recordDiagramFollowup } = await import('../followups')
    lockDiagramGroupMock.mockResolvedValue({ id: 'group-1', status: 'in_service' })
    const { log } = useTx(() => undefined)

    await expect(recordDiagramFollowup(args)).rejects.toThrow('Diagram quote is not awaiting an answer')
    expect(log).toHaveLength(0)
  })

  it('throws when the group does not exist for the tenant', async () => {
    const { recordDiagramFollowup } = await import('../followups')
    lockDiagramGroupMock.mockResolvedValue(null)
    useTx(() => undefined)

    await expect(recordDiagramFollowup(args)).rejects.toThrow('Diagram group not found')
  })
})

describe('snoozeDiagramGroup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rejects snoozing a quotation that is no longer awaiting an answer', async () => {
    const { snoozeDiagramGroup } = await import('../followups')
    lockDiagramGroupMock.mockResolvedValue({ id: 'group-1', status: 'declined' })
    const { log } = useTx(() => undefined)

    await expect(
      snoozeDiagramGroup({ tenantId: TENANT, groupId: 'group-1', userId: 'user-1', until: '2026-12-01' }),
    ).rejects.toThrow('Diagram quote is not awaiting an answer')
    expect(log).toHaveLength(0)
    expect(auditMock).not.toHaveBeenCalled()
  })

  it('stores the snooze day under the group lock and audits it in the same transaction', async () => {
    const { snoozeDiagramGroup } = await import('../followups')
    lockDiagramGroupMock.mockResolvedValue({ id: 'group-1', status: 'quote' })
    const { tx, log } = useTx(() => undefined)

    await snoozeDiagramGroup({ tenantId: TENANT, groupId: 'group-1', userId: 'user-1', until: '2026-12-01' })

    expect(lockDiagramGroupMock).toHaveBeenCalledWith(expect.anything(), TENANT, 'group-1')
    expect(log[0].capture.value).toMatchObject({ followupSnoozedUntil: '2026-12-01' })
    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: 'face_diagram_group',
        entityId: 'group-1',
        changes: { followupSnoozedUntil: { old: null, new: '2026-12-01' } },
      }),
      tx,
    )
  })
})
