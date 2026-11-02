import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import { chain, chainCapturing, type Capture } from '@/tests/mocks/drizzle-tx'

const { selectMock } = vi.hoisted(() => ({ selectMock: vi.fn() }))
vi.mock('@/db/client', () => ({ db: { select: selectMock } }))

import { getFaceDiagram, getPreviousDiagramPoints } from '../face-diagrams'

beforeEach(() => selectMock.mockReset())

// getPreviousDiagramPoints builds its EXISTS subquery with db.select first.
const offlineDb = drizzle.mock()
const subquery = () => selectMock.mockImplementationOnce((fields: never) => offlineDb.select(fields))

const point = (id: string, diagramId: string) => ({ id, faceDiagramId: diagramId, sortOrder: 0 })

describe('getFaceDiagram', () => {
  it('reads through the groups of the record, planning and session alike', async () => {
    // Regression: diagrams migrated into groups must still show in detail, approval and prontuario.
    const capture: Capture = {}
    selectMock
      .mockReturnValueOnce(
        chainCapturing(
          [
            { id: 'd-plan', viewType: 'front' },
            { id: 'd-session', viewType: 'front' },
          ],
          capture,
        ),
      )
      .mockReturnValueOnce(chain([point('p1', 'd-plan'), point('p2', 'd-session')]))

    const result = await getFaceDiagram('tenant-1', 'rec-1')

    const { sql, params } = new PgDialect().sqlToQuery(capture.where as SQL)
    expect(params).toEqual(['tenant-1', 'rec-1'])
    expect(sql).toContain('"face_diagram_groups"."procedure_record_id"')
    expect(sql).toContain('"deleted_at" is null')
    expect(result.map((d) => [d.id, d.points.map((p) => p.id)])).toEqual([
      ['d-plan', ['p1']],
      ['d-session', ['p2']],
    ])
  })
})

describe('getPreviousDiagramPoints', () => {
  it('lets standalone groups through while excluding the current procedure', async () => {
    // Regression: `ne` alone drops groups with a null procedure, hiding standalone diagrams from the ghost overlay.
    const capture: Capture = {}
    subquery()
    selectMock.mockReturnValueOnce(chainCapturing([], capture))

    await getPreviousDiagramPoints('tenant-1', 'patient-1', 'rec-1')

    const { sql, params } = new PgDialect().sqlToQuery(capture.where as SQL)
    expect(params).toEqual(expect.arrayContaining(['tenant-1', 'patient-1', 'rec-1']))
    expect(sql).toMatch(/"procedure_record_id" is null or .*"procedure_record_id" <> \$/)
  })

  it('returns every view of the latest group with its view type', async () => {
    // Regression: profile points were collapsed into the front view.
    subquery()
    selectMock
      .mockReturnValueOnce(chain([{ id: 'g1' }]))
      .mockReturnValueOnce(
        chain([
          { point: { id: 'p1' }, viewType: 'front' },
          { point: { id: 'p2' }, viewType: 'left_profile' },
          { point: { id: 'p3' }, viewType: 'right_profile' },
        ]),
      )

    const result = await getPreviousDiagramPoints('tenant-1', 'patient-1')

    expect(result.map((p) => [p.id, p.viewType])).toEqual([
      ['p1', 'front'],
      ['p2', 'left_profile'],
      ['p3', 'right_profile'],
    ])
  })
})
