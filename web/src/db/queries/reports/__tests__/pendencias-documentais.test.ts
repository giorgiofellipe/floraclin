import { describe, it, expect, vi, beforeEach } from 'vitest'

// listDocumentGaps issues four independent selects (patients, patientIds
// with an anamnese row, performed procedures joined to their type name, and
// procedure_record_ids with a signed consent acceptance) and joins them in
// JS. We drive a fake `db` with a FIFO queue of results, one array per
// top-level `db.select(...)` call, in the exact order the module issues
// them: patients, then anamnese rows, then performed procedures, then
// acceptance rows. Every chain method (from/innerJoin/where) is a no-op that
// returns the same node; only awaiting the chain (its `.then`) shifts the
// queue, so call order (not resolution order) determines which canned
// result lands where. Tenant scoping and soft-delete filtering happen in the
// real WHERE clauses (untestable through this mock), so those are exercised
// indirectly: a stray row referencing a patient id that was never in the
// pushed `patients` result must never surface, mirroring the precedent in
// inactive-patients.test.ts.
const { selectQueue, resetQueue, makeChain } = vi.hoisted(() => {
  const selectQueue: unknown[][] = []
  function makeChain() {
    const node: Record<string, unknown> = {}
    node.from = () => node
    node.innerJoin = () => node
    node.where = () => node
    node.then = (resolve: (v: unknown) => void, reject?: (e: unknown) => void) =>
      Promise.resolve(selectQueue.shift() ?? []).then(resolve, reject)
    return node
  }
  return {
    selectQueue,
    resetQueue: () => {
      selectQueue.length = 0
    },
    makeChain,
  }
})

vi.mock('@/db/client', () => ({
  db: {
    select: vi.fn(() => makeChain()),
  },
}))

vi.mock('@/db/schema', () => ({
  patients: {
    id: 'id',
    tenantId: 'tenant_id',
    deletedAt: 'deleted_at',
    fullName: 'full_name',
    phone: 'phone',
  },
  anamneses: {
    patientId: 'patient_id',
    tenantId: 'tenant_id',
  },
  procedureRecords: {
    id: 'id',
    patientId: 'patient_id',
    tenantId: 'tenant_id',
    deletedAt: 'deleted_at',
    performedAt: 'performed_at',
    procedureTypeId: 'procedure_type_id',
  },
  procedureTypes: {
    id: 'id',
    name: 'name',
  },
  consentAcceptances: {
    procedureRecordId: 'procedure_record_id',
    tenantId: 'tenant_id',
  },
}))

vi.mock('drizzle-orm', () => ({
  and: (...args: unknown[]) => args,
  eq: (a: unknown, b: unknown) => ['eq', a, b],
  isNull: (a: unknown) => ['isNull', a],
  isNotNull: (a: unknown) => ['isNotNull', a],
}))

import { listDocumentGaps } from '../pendencias-documentais'

function pushResults(
  patientRows: unknown[],
  anamneseRows: unknown[],
  procedureRows: unknown[],
  acceptanceRows: unknown[],
) {
  selectQueue.push(patientRows)
  selectQueue.push(anamneseRows)
  selectQueue.push(procedureRows)
  selectQueue.push(acceptanceRows)
}

function patient(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'p1',
    fullName: 'Patient One',
    phone: '11999990000',
    ...overrides,
  }
}

function procedure(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'proc1',
    patientId: 'p1',
    performedAt: new Date('2026-05-01T14:00:00.000Z'),
    procedureTypeName: 'Botox',
    ...overrides,
  }
}

describe('listDocumentGaps', () => {
  beforeEach(() => {
    resetQueue()
  })

  it('includes a patient with no anamnese row at all', async () => {
    pushResults([patient()], [], [], [])

    const rows = await listDocumentGaps('tenant-1', {})

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      patientId: 'p1',
      missing: 'anamnese',
      procedureTypeName: null,
      procedureDate: null,
    })
  })

  it('excludes a patient with a completed anamnese and every consent signed', async () => {
    pushResults(
      [patient()],
      [{ patientId: 'p1' }],
      [procedure({ id: 'proc1' })],
      [{ procedureRecordId: 'proc1' }],
    )

    const rows = await listDocumentGaps('tenant-1', {})

    expect(rows).toEqual([])
  })

  it('includes a patient with a performed procedure and no signed consent acceptance', async () => {
    pushResults(
      [patient()],
      [{ patientId: 'p1' }], // has anamnese
      [procedure({ id: 'proc1', procedureTypeName: 'Preenchimento', performedAt: new Date('2026-05-02T14:00:00.000Z') })],
      [], // no acceptance anywhere
    )

    const rows = await listDocumentGaps('tenant-1', {})

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      patientId: 'p1',
      missing: 'consentimento',
      procedureTypeName: 'Preenchimento',
      procedureDate: '2026-05-02',
    })
  })

  it('marks a row "both" when the anamnese is missing and a performed procedure lacks consent', async () => {
    pushResults([patient()], [], [procedure()], [])

    const rows = await listDocumentGaps('tenant-1', {})

    expect(rows).toHaveLength(1)
    expect(rows[0].missing).toBe('both')
  })

  it('does not flag a consent gap for a procedure that has a signed acceptance, even with other unsigned ones', async () => {
    pushResults(
      [patient()],
      [{ patientId: 'p1' }],
      [
        procedure({ id: 'signed', performedAt: new Date('2026-04-01T14:00:00.000Z') }),
        procedure({ id: 'unsigned', performedAt: new Date('2026-05-01T14:00:00.000Z'), procedureTypeName: 'Enzima' }),
      ],
      [{ procedureRecordId: 'signed' }],
    )

    const rows = await listDocumentGaps('tenant-1', {})

    expect(rows).toHaveLength(1)
    expect(rows[0].procedureTypeName).toBe('Enzima')
  })

  it('surfaces only the most recently performed unsigned procedure when a patient has more than one gap', async () => {
    pushResults(
      [patient()],
      [{ patientId: 'p1' }],
      [
        procedure({ id: 'old', performedAt: new Date('2026-01-01T14:00:00.000Z'), procedureTypeName: 'Antigo' }),
        procedure({ id: 'new', performedAt: new Date('2026-06-01T14:00:00.000Z'), procedureTypeName: 'Recente' }),
      ],
      [],
    )

    const rows = await listDocumentGaps('tenant-1', {})

    expect(rows).toHaveLength(1)
    expect(rows[0].procedureTypeName).toBe('Recente')
    expect(rows[0].procedureDate).toBe('2026-06-01')
  })

  it('never surfaces a patient id that was not returned by the (tenant-scoped, soft-delete-filtered) patients query', async () => {
    // The real WHERE clauses on `patients` (tenant + deleted_at IS NULL) and
    // `procedure_records` (tenant + deleted_at IS NULL) are what keep other
    // tenants' and soft-deleted rows out in production; this mock can't
    // exercise SQL directly, so instead it proves the join logic itself
    // never invents a row for a patient id absent from the patients result,
    // even when a stray procedure/anamnese row references one: exactly what
    // a cross-tenant or soft-deleted leak would look like if the WHERE
    // clause were ever dropped.
    pushResults(
      [patient({ id: 'in-tenant', fullName: 'In Tenant' })],
      [],
      [
        procedure({ id: 'proc-foreign', patientId: 'not-in-patients-result', procedureTypeName: 'Other' }),
      ],
      [],
    )

    const rows = await listDocumentGaps('tenant-1', {})

    expect(rows).toHaveLength(1)
    expect(rows[0].patientId).toBe('in-tenant')
    expect(rows.some((r) => r.patientId === 'not-in-patients-result')).toBe(false)
  })

  it('caps results at 200 rows', async () => {
    const many = Array.from({ length: 250 }, (_, i) =>
      patient({ id: `p${i}`, fullName: `Patient ${i}` }),
    )
    pushResults(many, [], [], [])

    const rows = await listDocumentGaps('tenant-1', {})

    expect(rows).toHaveLength(200)
  })

  it('orders by most recent procedure gap first, after sorting (not before) the cap', async () => {
    const many = Array.from({ length: 250 }, (_, i) => ({
      patientRow: patient({ id: `p${i}`, fullName: `Patient ${String(i).padStart(3, '0')}` }),
      procedureRow: procedure({
        id: `proc${i}`,
        patientId: `p${i}`,
        // Ascending insertion order, so the newest date belongs to the last
        // patient pushed (p249). A cap-before-sort bug would keep only
        // p000..p199 and top out at p199 instead of p249.
        performedAt: new Date(2026, 0, 1 + i),
      }),
    }))

    pushResults(
      many.map((m) => m.patientRow),
      [],
      many.map((m) => m.procedureRow),
      [],
    )

    const rows = await listDocumentGaps('tenant-1', {})

    expect(rows).toHaveLength(200)
    expect(rows[0].patientId).toBe('p249')
    expect(rows[rows.length - 1].patientId).toBe('p50')
  })

  it('sorts anamnese-only gaps (no procedure date) after every dated consent gap in the default order', async () => {
    pushResults(
      [
        patient({ id: 'anamnese-only', fullName: 'No Date' }),
        patient({ id: 'older-gap', fullName: 'Older Gap' }),
        patient({ id: 'newer-gap', fullName: 'Newer Gap' }),
      ],
      [{ patientId: 'older-gap' }, { patientId: 'newer-gap' }], // anamnese-only patient has none
      [
        procedure({ id: 'proc-older', patientId: 'older-gap', performedAt: new Date('2026-01-01T14:00:00.000Z') }),
        procedure({ id: 'proc-newer', patientId: 'newer-gap', performedAt: new Date('2026-06-01T14:00:00.000Z') }),
      ],
      [],
    )

    const rows = await listDocumentGaps('tenant-1', {})

    expect(rows.map((r) => r.patientId)).toEqual(['newer-gap', 'older-gap', 'anamnese-only'])
  })

  it('applies an explicit sort by fullName, overriding the default order', async () => {
    pushResults(
      [patient({ id: 'z', fullName: 'Zoe Almeida' }), patient({ id: 'a', fullName: 'Ana Souza' })],
      [],
      [],
      [],
    )

    const rows = await listDocumentGaps('tenant-1', { sort: { key: 'fullName', dir: 'asc' } })

    expect(rows.map((r) => r.patientId)).toEqual(['a', 'z'])
  })
})
