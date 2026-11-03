import { beforeAll, describe, expect, it } from 'vitest'
import { db } from '@/db/client'
import {
  diagramPoints,
  faceDiagramGroups,
  faceDiagrams,
  patients,
  procedureRecords,
  procedureSessions,
  procedureTypes,
  tenants,
  users,
} from '@/db/schema'
import { getPreviousDiagramPoints } from '../face-diagrams'

const RUN_INTEGRATION = Boolean(process.env.DATABASE_URL_TEST || process.env.RUN_DB_TESTS)
const describeIntegration = RUN_INTEGRATION ? describe : describe.skip

const TENANT = '00000000-0000-0000-0000-0000000d1a01'
const USER = '00000000-0000-0000-0000-0000000d1a02'
const PATIENT = '00000000-0000-0000-0000-0000000d1a03'
const TYPE = '00000000-0000-0000-0000-0000000d1a04'
const DONE = '00000000-0000-0000-0000-0000000d1a05'
const OPEN = '00000000-0000-0000-0000-0000000d1a06'
const SESSION = '00000000-0000-0000-0000-0000000d1a07'

async function groupWithPoint(
  group: Partial<typeof faceDiagramGroups.$inferInsert> & { createdAt: Date },
  productName: string,
) {
  const [g] = await db
    .insert(faceDiagramGroups)
    .values({ tenantId: TENANT, patientId: PATIENT, practitionerId: USER, ...group })
    .returning({ id: faceDiagramGroups.id })
  const [d] = await db
    .insert(faceDiagrams)
    .values({ tenantId: TENANT, groupId: g.id, viewType: 'front' })
    .returning({ id: faceDiagrams.id })
  await db.insert(diagramPoints).values({
    tenantId: TENANT, faceDiagramId: d.id, x: '1', y: '1', productName, quantity: '1',
  })
}

describeIntegration('getPreviousDiagramPoints (integration, requires test DB)', () => {
  beforeAll(async () => {
    await db.insert(tenants).values({ id: TENANT, name: 'Ghost', slug: 'ghost-overlay-test' })
    await db.insert(users).values({ id: USER, email: 'ghost@test.local', fullName: 'Dra.' })
    await db.insert(patients).values({ id: PATIENT, tenantId: TENANT, fullName: 'Ana', phone: '11999990000' })
    await db.insert(procedureTypes).values({ id: TYPE, tenantId: TENANT, name: 'Botox', category: 'toxin' })
    await db.insert(procedureRecords).values([
      { id: DONE, tenantId: TENANT, patientId: PATIENT, practitionerId: USER, procedureTypeId: TYPE, status: 'completed' },
      { id: OPEN, tenantId: TENANT, patientId: PATIENT, practitionerId: USER, procedureTypeId: TYPE, status: 'in_progress' },
    ])
    await db.insert(procedureSessions).values({
      id: SESSION, tenantId: TENANT, procedureRecordId: OPEN, sessionOrdinal: 1, executedBy: USER, performedAt: new Date(),
    })

    await groupWithPoint({ procedureRecordId: DONE, origin: 'wizard', createdAt: new Date('2026-01-01') }, 'completed-plan')
    await groupWithPoint({ procedureRecordId: OPEN, procedureSessionId: SESSION, origin: 'wizard', createdAt: new Date('2026-02-01') }, 'session')
    await groupWithPoint({ procedureRecordId: OPEN, origin: 'standalone', createdAt: new Date('2026-03-01') }, 'open-plan')
    await groupWithPoint({ origin: 'standalone', createdAt: new Date('2026-04-01') }, 'quote')
  })

  it('shows the latest session, skipping newer quotes and plans not yet applied', async () => {
    const points = await getPreviousDiagramPoints(TENANT, PATIENT)
    expect(points.map((p) => p.productName)).toEqual(['session'])
  })

  it('falls back to a completed procedure plan when the current procedure is excluded', async () => {
    const points = await getPreviousDiagramPoints(TENANT, PATIENT, OPEN)
    expect(points.map((p) => p.productName)).toEqual(['completed-plan'])
  })
})
