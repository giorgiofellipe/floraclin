import { describe, expect, it, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'
import { isLock, routedTx, tableOf, whereParams, type LoggedQuery } from '@/tests/mocks/drizzle-tx'

vi.mock('@/db/client', () => ({ db: {} }))

import { faceDiagramGroups, procedureRecords } from '@/db/schema'
import {
  DiagramGroupLockedError,
  ensurePlanningGroup,
  linkGroupToProcedure,
  releaseStandaloneGroups,
  updateStandaloneGroup,
} from '../face-diagram-groups'
import { cancelProcedure } from '../procedures'

const TENANT = 'tenant-1'
const PATIENT = 'patient-1'
const GROUP = 'group-1'

interface World {
  group?: { procedureRecordId: string | null; patientId?: string }
  procedureStatus?: string
  patientRecords?: { id: string; status: string }[]
}

function worldTx(world: World) {
  const { tx, log } = routedTx((q: LoggedQuery) => {
    const table = tableOf(q)
    if (q.op === 'select' && table === faceDiagramGroups) {
      if (!world.group) return []
      return [
        {
          id: GROUP,
          patientId: world.group.patientId ?? PATIENT,
          origin: 'standalone',
          procedureRecordId: world.group.procedureRecordId,
          procedureSessionId: null,
          declinedAt: null,
        },
      ]
    }
    if (q.op === 'select' && table === procedureRecords) {
      const listsPatientRecords = 'id' in (q.fields as object)
      return listsPatientRecords ? world.patientRecords ?? [] : [{ status: world.procedureStatus }]
    }
    return []
  })
  return { tx: tx as never, log }
}

const writes = (log: LoggedQuery[]) => log.filter((q) => q.op !== 'select')

describe('updateStandaloneGroup', () => {
  it('refuses to edit a quotation whose procedure is already approved', async () => {
    // Regression: editing the diagram after approval would change what the patient signed.
    const { tx, log } = worldTx({ group: { procedureRecordId: 'rec-1' }, procedureStatus: 'approved' })

    await expect(
      updateStandaloneGroup(tx, { tenantId: TENANT, groupId: GROUP, views: [], quotationLines: [] }),
    ).rejects.toBeInstanceOf(DiagramGroupLockedError)
    expect(writes(log)).toHaveLength(0)
  })
})

describe('linkGroupToProcedure', () => {
  const input = { tenantId: TENANT, patientId: PATIENT, groupId: GROUP, procedureRecordId: 'new-rec' }

  it('locks the group row before deciding', async () => {
    const { tx, log } = worldTx({ group: { procedureRecordId: null }, patientRecords: [{ id: 'new-rec', status: 'draft' }] })
    await linkGroupToProcedure(tx, input)

    expect(isLock(log[0])).toBe(true)
    expect(writes(log)).toHaveLength(1)
  })

  it('refuses a group already in service', async () => {
    // Regression: two tabs attaching the same quotation to two atendimentos.
    const { tx, log } = worldTx({ group: { procedureRecordId: 'rec-1' }, procedureStatus: 'in_progress' })
    await expect(linkGroupToProcedure(tx, input)).rejects.toBeInstanceOf(DiagramGroupLockedError)
    expect(writes(log)).toHaveLength(0)
  })

  it('refuses a group of another patient', async () => {
    const { tx, log } = worldTx({ group: { procedureRecordId: null, patientId: 'other' } })
    await expect(linkGroupToProcedure(tx, input)).rejects.toBeInstanceOf(DiagramGroupLockedError)
    expect(writes(log)).toHaveLength(0)
  })

  it('refuses when the patient has another open atendimento', async () => {
    // Regression: a crafted URL attaching a quote to a second atendimento.
    const { tx, log } = worldTx({
      group: { procedureRecordId: null },
      patientRecords: [
        { id: 'new-rec', status: 'draft' },
        { id: 'other-rec', status: 'in_progress' },
      ],
    })
    await expect(linkGroupToProcedure(tx, input)).rejects.toBeInstanceOf(DiagramGroupLockedError)
    expect(writes(log)).toHaveLength(0)
  })
})

describe('ensurePlanningGroup', () => {
  it('returns the existing planning group without inserting', async () => {
    const { tx, log } = routedTx(() => [{ id: 'existing' }])
    const id = await ensurePlanningGroup(tx as never, {
      tenantId: TENANT,
      patientId: PATIENT,
      practitionerId: 'u1',
      procedureRecordId: 'rec-1',
    })

    expect(id).toBe('existing')
    expect(writes(log)).toHaveLength(0)
  })
})

describe('releaseStandaloneGroups', () => {
  it('only releases standalone planning groups of the given records', async () => {
    // Regression: a cancelled atendimento must not detach a wizard group.
    const { tx, log } = routedTx(() => [{ id: 'g1' }])
    const count = await releaseStandaloneGroups(tx as never, TENANT, ['rec-1'])

    const update = log.find((q) => q.op === 'update')!
    const { sql, params } = new PgDialect().sqlToQuery(update.capture.where as SQL)
    expect(count).toBe(1)
    expect(params).toEqual(expect.arrayContaining([TENANT, 'rec-1', 'standalone']))
    expect(sql).toContain('"procedure_session_id" is null')
    expect(update.capture.value).toMatchObject({ procedureRecordId: null })
  })
})

describe('cancelProcedure', () => {
  it('sends the standalone quotation back to Orçamento in the same transaction', async () => {
    const { tx, log } = routedTx((q) => (tableOf(q) === procedureRecords ? [{ id: 'rec-1' }] : [{ id: 'g1' }]))
    await cancelProcedure(TENANT, 'rec-1', 'motivo', tx as never)

    const release = log.find((q) => tableOf(q) === faceDiagramGroups && q.op === 'update')!
    expect(release.capture.value).toMatchObject({ procedureRecordId: null })
    expect(whereParams(release.capture)).toContain('standalone')
  })
})
