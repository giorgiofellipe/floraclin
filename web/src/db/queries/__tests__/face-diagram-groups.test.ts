import { describe, expect, it, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'
import {
  isLock,
  routedTx,
  selectSql,
  tableOf,
  whereParams,
  type LoggedQuery,
} from '@/tests/mocks/drizzle-tx'

const dbMock = vi.hoisted(() => ({}) as Record<string, unknown>)
vi.mock('@/db/client', () => ({ db: dbMock }))

import { faceDiagramGroups, patients, procedureRecords, procedureTypes } from '@/db/schema'
import {
  DiagramGroupLockedError,
  DiagramGroupNotFoundError,
  InvalidQuotationLineError,
  createStandaloneGroup,
  ensurePlanningGroup,
  getDiagramGroup,
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
  procedureTypes?: { id: string; name: string }[]
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
    if (q.op === 'select' && table === procedureTypes) return world.procedureTypes ?? []
    if (q.op === 'insert' && table === faceDiagramGroups) return [{ id: GROUP }]
    return []
  })
  return { tx: tx as never, log }
}

const writes = (log: LoggedQuery[]) => log.filter((q) => q.op !== 'select')

const BOTOX_ID = '11111111-1111-4111-8111-111111111111'
const line = { procedureTypeId: BOTOX_ID, procedureTypeName: 'Nome do cliente', sessions: 1, unitPrice: 100 }

describe('updateStandaloneGroup', () => {
  it('refuses to edit a quotation whose procedure is already approved', async () => {
    // Regression: editing the diagram after approval would change what the patient signed.
    const { tx, log } = worldTx({ group: { procedureRecordId: 'rec-1' }, procedureStatus: 'approved' })

    await expect(
      updateStandaloneGroup(tx, { tenantId: TENANT, groupId: GROUP, views: [], quotationLines: [] }),
    ).rejects.toBeInstanceOf(DiagramGroupLockedError)
    expect(writes(log)).toHaveLength(0)
  })

  it('reports a missing group as not found, not as locked', async () => {
    const { tx } = worldTx({})
    await expect(
      updateStandaloneGroup(tx, { tenantId: TENANT, groupId: GROUP, views: [], quotationLines: [] }),
    ).rejects.toBeInstanceOf(DiagramGroupNotFoundError)
  })

  it('rejects a quotation line whose procedure type is not an active type of the tenant', async () => {
    // Regression: the client could price a foreign or deleted procedure type.
    const { tx, log } = worldTx({ group: { procedureRecordId: null }, procedureTypes: [] })
    await expect(
      updateStandaloneGroup(tx, { tenantId: TENANT, groupId: GROUP, views: [], quotationLines: [line] }),
    ).rejects.toBeInstanceOf(InvalidQuotationLineError)
    expect(writes(log)).toHaveLength(0)
  })
})

describe('createStandaloneGroup', () => {
  const input = { tenantId: TENANT, patientId: PATIENT, practitionerId: 'u1', views: [] }

  it('stores the procedure name from the tenant catalog, not the client', async () => {
    const { tx, log } = worldTx({ procedureTypes: [{ id: BOTOX_ID, name: 'Toxina botulínica' }] })
    await createStandaloneGroup(tx, { ...input, quotationLines: [line] })

    const typeLookup = log.find((q) => tableOf(q) === procedureTypes)!
    const sql = selectSql(typeLookup.fields, typeLookup.capture)
    expect(whereParams(typeLookup.capture)).toEqual(expect.arrayContaining([TENANT, BOTOX_ID, true]))
    expect(sql).toContain('"procedure_types"."deleted_at" is null')
    const insert = log.find((q) => q.op === 'insert' && tableOf(q) === faceDiagramGroups)!
    expect(insert.capture.value).toMatchObject({
      quotationLines: [{ ...line, procedureTypeName: 'Toxina botulínica' }],
    })
  })

  it('rejects an unknown procedure type without creating the group', async () => {
    const { tx, log } = worldTx({ procedureTypes: [] })
    await expect(createStandaloneGroup(tx, { ...input, quotationLines: [line] })).rejects.toBeInstanceOf(
      InvalidQuotationLineError,
    )
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

  it('locks the patient row before reading the other open atendimentos', async () => {
    // Regression: two concurrent links for one patient both passed the open-procedure check.
    const { tx, log } = worldTx({ group: { procedureRecordId: null }, patientRecords: [{ id: 'new-rec', status: 'draft' }] })
    await linkGroupToProcedure(tx, input)

    const patientLock = log.findIndex((q) => tableOf(q) === patients && isLock(q))
    const openCheck = log.findIndex((q) => tableOf(q) === procedureRecords && 'id' in (q.fields as object))
    expect(patientLock).toBeGreaterThan(-1)
    expect(patientLock).toBeLessThan(openCheck)
    expect(whereParams(log[patientLock].capture)).toEqual([PATIENT, TENANT])
  })

  it('reports a missing group as not found', async () => {
    const { tx } = worldTx({})
    await expect(linkGroupToProcedure(tx, input)).rejects.toBeInstanceOf(DiagramGroupNotFoundError)
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

describe('getDiagramGroup', () => {
  function useDb(row: Record<string, unknown> | null) {
    const { tx, log } = routedTx((q) => (tableOf(q) === faceDiagramGroups && row ? [row] : []))
    Object.assign(dbMock, tx)
    return log
  }

  const groupRow = {
    id: GROUP,
    patientId: PATIENT,
    origin: 'wizard',
    procedureRecordId: 'rec-1',
    declinedAt: null,
    quotationLines: [],
    procedureStatus: 'approved',
    financialPlan: { totalAmount: '1500.00' },
  }

  it('hides groups of a deleted patient', async () => {
    // Regression: a deleted patient's diagrams stayed reachable by direct id.
    const log = useDb(null)
    await getDiagramGroup(TENANT, GROUP)

    const read = log[0]
    expect(selectSql(read.fields, read.capture)).toContain('"patients"."deleted_at" is null')
  })

  it('shows no quotation total on a session group', async () => {
    // Regression: a session showed the whole package total as if it were its own price.
    useDb({ ...groupRow, procedureSessionId: 'session-1' })
    expect((await getDiagramGroup(TENANT, GROUP))?.quotationTotal).toBeNull()
  })

  it('falls back to the procedure plan total on a planning group', async () => {
    useDb({ ...groupRow, procedureSessionId: null })
    expect((await getDiagramGroup(TENANT, GROUP))?.quotationTotal).toBe(1500)
  })
})
