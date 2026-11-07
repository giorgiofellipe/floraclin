import { describe, it, expect, vi, beforeEach } from 'vitest'
import { chainCapturing, selectSql, whereParams, type Capture } from '@/tests/mocks/drizzle-tx'

const dbMock = { select: vi.fn() }
vi.mock('@/db/client', () => ({ db: dbMock }))

const authMock = vi.fn()
vi.mock('@/lib/auth', () => ({ getAuthContext: () => authMock() }))

const TENANT = '00000000-0000-0000-0000-00000000a001'
const PRACTITIONER = '00000000-0000-0000-0000-00000000b001'
const TYPE_ID = '00000000-0000-0000-0000-00000000c001'

function stubSelect(rows: unknown[]) {
  const capture: Capture = {}
  let fields: unknown
  dbMock.select.mockImplementationOnce((f: unknown) => {
    fields = f
    return chainCapturing(rows, capture)
  })
  return { capture, fields: () => fields }
}

// Load the query module before timed tests and fake timers start.
const {
  listOpenDiagramQuotes,
} = await import('../followups')

describe('listOpenDiagramQuotes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // A wizard group whose procedure was cancelled keeps its
  // procedure_record_id, so it must stay out of the list; a standalone group
  // released by releaseStandaloneGroups has it nulled and must come back.
  it('only selects standalone groups of live patients with no atendimento, no session and not declined', async () => {
    const { capture, fields } = stubSelect([])

    await listOpenDiagramQuotes({ tenantId: TENANT })

    const sqlText = selectSql(fields(), capture)
    expect(sqlText).toContain('"deleted_at" is null')
    expect(sqlText).toContain('"origin" = $')
    expect(sqlText).toContain('"procedure_session_id" is null')
    expect(sqlText).toContain('"procedure_record_id" is null')
    expect(sqlText).toContain('"declined_at" is null')
    expect(sqlText).toContain('"patients"."deleted_at" is null')
    expect(whereParams(capture)).toContain('standalone')
    expect(whereParams(capture)).toContain(TENANT)
  })

  it('maps a group to a quote row linking to the diagram, naming the first line plus the rest', async () => {
    const createdAt = new Date('2026-10-01T15:00:00.000Z')
    stubSelect([
      {
        id: 'group-1',
        patientId: 'patient-1',
        patientName: 'Ana',
        patientPhone: '11999999999',
        practitionerId: PRACTITIONER,
        practitionerName: 'Dra. Bia',
        quotationLines: [
          { procedureTypeId: TYPE_ID, procedureTypeName: 'Botox', sessions: 2, unitPrice: 100.1 },
          { procedureTypeId: 'type-2', procedureTypeName: 'Preenchimento', sessions: 1, unitPrice: 50 },
        ],
        createdAt,
        lastContactedAt: null,
        snoozedUntil: null,
      },
    ])

    const [row] = await listOpenDiagramQuotes({ tenantId: TENANT })

    expect(row).toMatchObject({
      kind: 'diagram_quote',
      href: '/pacientes/patient-1/diagramas/group-1',
      id: 'group-1',
      procedureTypeName: 'Botox +1',
      totalAmount: '250.2',
      status: 'quote',
      performedAt: null,
      practitionerName: 'Dra. Bia',
    })
  })

  it('filters by practitioner and by any line of the quote when asked', async () => {
    const { capture } = stubSelect([])

    await listOpenDiagramQuotes({
      tenantId: TENANT,
      practitionerId: PRACTITIONER,
      procedureTypeId: TYPE_ID,
    })

    const params = whereParams(capture)
    expect(params).toContain(PRACTITIONER)
    expect(params).toContain(JSON.stringify([{ procedureTypeId: TYPE_ID }]))
  })
})

describe('GET /api/planejamentos', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('scopes a practitioner to their own procedures and quotes, ignoring the practitionerId param', async () => {
    authMock.mockResolvedValue({ tenantId: TENANT, userId: PRACTITIONER, role: 'practitioner' })
    const procedures = stubSelect([])
    const quotes = stubSelect([])
    const { GET } = await import('@/app/api/planejamentos/route')

    const res = await GET(new Request('http://x/api/planejamentos?practitionerId=someone-else'))

    expect(res.status).toBe(200)
    expect(whereParams(procedures.capture)).toContain(PRACTITIONER)
    expect(whereParams(procedures.capture)).not.toContain('someone-else')
    expect(whereParams(quotes.capture)).toContain(PRACTITIONER)
    expect(whereParams(quotes.capture)).not.toContain('someone-else')
  })

  it('merges procedures and quotes by staleness and applies the limit after merging', async () => {
    authMock.mockResolvedValue({ tenantId: TENANT, userId: 'owner-1', role: 'owner' })
    const base = { patientId: 'p', patientName: 'N', patientPhone: '1', practitionerId: 'u', practitionerName: 'U', snoozedUntil: null }
    stubSelect([
      {
        ...base, id: 'proc-new', procedureTypeId: 't', procedureTypeName: 'T', status: 'planned',
        performedAt: null, followUpDate: null, financialPlan: null,
        createdAt: new Date('2026-10-20T12:00:00Z'), lastContactedAt: null,
      },
    ])
    stubSelect([
      { ...base, id: 'quote-old', quotationLines: [], createdAt: new Date('2026-09-01T12:00:00Z'), lastContactedAt: null },
      { ...base, id: 'quote-mid', quotationLines: [], createdAt: new Date('2026-08-01T12:00:00Z'), lastContactedAt: new Date('2026-10-10T12:00:00Z') },
    ])
    const { GET } = await import('@/app/api/planejamentos/route')

    const res = await GET(new Request('http://x/api/planejamentos?limit=2'))
    const body = await res.json()

    expect(body.data.map((r: { id: string }) => r.id)).toEqual(['quote-old', 'quote-mid'])
  })
})
