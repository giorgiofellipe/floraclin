import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '@/db/client'
import { appointments, financialEntries, patients, procedureRecords, procedureTypes, tenants, users } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { brToday } from '@/lib/dates'
import { getTodayAppointments } from '../dashboard'

const RUN_INTEGRATION = Boolean(process.env.DATABASE_URL_TEST || process.env.RUN_DB_TESTS)
const describeIntegration = RUN_INTEGRATION ? describe : describe.skip

const TENANT = '00000000-0000-0000-0000-0000000d5b01'
const USER = '00000000-0000-0000-0000-0000000d5b02'
const PATIENT = '00000000-0000-0000-0000-0000000d5b03'
const PROC_TYPE = '00000000-0000-0000-0000-0000000d5b04'
const APPT = {
  direct: '00000000-0000-0000-0000-0000000d5b10',
  viaRecord: '00000000-0000-0000-0000-0000000d5b11',
  cancelledOnly: '00000000-0000-0000-0000-0000000d5b12',
  none: '00000000-0000-0000-0000-0000000d5b13',
  deletedRecord: '00000000-0000-0000-0000-0000000d5b14',
}

async function charge(status: string, link: { appointmentId?: string; procedureRecordId?: string }) {
  await db.insert(financialEntries).values({ tenantId: TENANT, patientId: PATIENT, description: 'c', totalAmount: '100.00', status, createdBy: USER, ...link })
}

// The Painel offers "Cobrar" on a finished appointment only while nothing charges it yet.
describeIntegration('getTodayAppointments hasCharge (integration, requires test DB)', () => {
  beforeAll(async () => {
    await db.insert(tenants).values({ id: TENANT, name: 'Painel', slug: 'painel-charge-test' })
    await db.insert(users).values({ id: USER, email: 'painel@test.local', fullName: 'Dra.' })
    await db.insert(patients).values({ id: PATIENT, tenantId: TENANT, fullName: 'Ana', phone: '11999990000' })
    await db.insert(procedureTypes).values({ id: PROC_TYPE, tenantId: TENANT, name: 'Toxina', category: 'botox' })
    for (const [i, id] of Object.values(APPT).entries()) {
      await db.insert(appointments).values({
        id, tenantId: TENANT, patientId: PATIENT, practitionerId: USER, date: brToday(),
        startTime: `${String(8 + i).padStart(2, '0')}:00`, endTime: `${String(8 + i).padStart(2, '0')}:30`, status: 'completed',
      })
    }
    await charge('pending', { appointmentId: APPT.direct })
    const [record] = await db
      .insert(procedureRecords)
      .values({ tenantId: TENANT, patientId: PATIENT, practitionerId: USER, procedureTypeId: PROC_TYPE, appointmentId: APPT.viaRecord })
      .returning({ id: procedureRecords.id })
    await charge('paid', { procedureRecordId: record.id })
    await charge('cancelled', { appointmentId: APPT.cancelledOnly })
    const [deleted] = await db
      .insert(procedureRecords)
      .values({ tenantId: TENANT, patientId: PATIENT, practitionerId: USER, procedureTypeId: PROC_TYPE, appointmentId: APPT.deletedRecord, deletedAt: new Date() })
      .returning({ id: procedureRecords.id })
    await charge('pending', { procedureRecordId: deleted.id })
  })

  afterAll(async () => {
    for (const table of [financialEntries, procedureRecords, appointments, procedureTypes, patients]) {
      await db.delete(table).where(eq(table.tenantId, TENANT))
    }
    await db.delete(users).where(eq(users.id, USER))
    await db.delete(tenants).where(eq(tenants.id, TENANT))
  })

  it('marks appointments charged directly or through their live procedure record, ignoring cancelled charges', async () => {
    const rows = await getTodayAppointments(TENANT)
    const byId = Object.fromEntries(rows.map((r) => [r.id, r.hasCharge]))
    expect(byId).toEqual({ [APPT.direct]: true, [APPT.viaRecord]: true, [APPT.cancelledOnly]: false, [APPT.none]: false, [APPT.deletedRecord]: false })
  })
})
