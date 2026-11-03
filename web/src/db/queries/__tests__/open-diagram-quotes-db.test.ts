import { beforeAll, describe, expect, it } from 'vitest'
import { db } from '@/db/client'
import { faceDiagramGroups, patients, tenants, users } from '@/db/schema'
import { listOpenDiagramQuotes } from '../followups'

const RUN_INTEGRATION = Boolean(process.env.DATABASE_URL_TEST || process.env.RUN_DB_TESTS)
const describeIntegration = RUN_INTEGRATION ? describe : describe.skip

const TENANT = '00000000-0000-0000-0000-0000000e1a01'
const USER = '00000000-0000-0000-0000-0000000e1a02'
const PATIENT = '00000000-0000-0000-0000-0000000e1a03'
const QUOTE = '00000000-0000-0000-0000-0000000e1a04'
const line = { procedureTypeId: '00000000-0000-0000-0000-0000000e1a05', procedureTypeName: 'Botox', sessions: 1, unitPrice: 900 }

describeIntegration('listOpenDiagramQuotes (integration, requires test DB)', () => {
  beforeAll(async () => {
    await db.insert(tenants).values({ id: TENANT, name: 'Quotes', slug: 'open-diagram-quotes-test' })
    await db.insert(users).values({ id: USER, email: 'quotes@test.local', fullName: 'Dra.' })
    await db.insert(patients).values({ id: PATIENT, tenantId: TENANT, fullName: 'Ana', phone: '11999990000' })
    const base = { tenantId: TENANT, patientId: PATIENT, practitionerId: USER, origin: 'standalone' as const }
    await db.insert(faceDiagramGroups).values([
      { ...base, id: QUOTE, quotationLines: [line] },
      { ...base, quotationLines: [] },
      { ...base, quotationLines: null },
    ])
  })

  it('lists only diagrams that were made an orçamento', async () => {
    const rows = await listOpenDiagramQuotes({ tenantId: TENANT })
    expect(rows.map((r) => r.id)).toEqual([QUOTE])
  })
})
