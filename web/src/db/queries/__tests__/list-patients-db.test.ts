import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { inArray } from 'drizzle-orm'
import { db } from '@/db/client'
import { appointments, patients, tenants, users } from '@/db/schema'
import { brToday, shiftBrYmd } from '@/lib/dates'
import { listPatients } from '../patients'

const RUN_INTEGRATION = Boolean(process.env.DATABASE_URL_TEST || process.env.RUN_DB_TESTS)
const describeIntegration = RUN_INTEGRATION ? describe : describe.skip

const TENANT = '00000000-0000-0000-0000-0000000a1501'
const OTHER_TENANT = '00000000-0000-0000-0000-0000000a1502'
const USER = '00000000-0000-0000-0000-0000000a1503'
const ANA = '00000000-0000-0000-0000-0000000a1504'
const BIA = '00000000-0000-0000-0000-0000000a1505'
const CAIO = '00000000-0000-0000-0000-0000000a1506'

const TODAY = brToday()
const day = (offset: number) => shiftBrYmd(TODAY, offset)

async function appointment(patientId: string, offset: number, status: string, startTime = '10:00', tenantId = TENANT) {
  await db.insert(appointments).values({
    tenantId,
    patientId,
    practitionerId: USER,
    date: day(offset),
    startTime,
    endTime: '11:00',
    status,
  })
}

describeIntegration('listPatients next appointment and last visit (integration, requires test DB)', () => {
  beforeAll(async () => {
    await db.insert(tenants).values([
      { id: TENANT, name: 'Lista', slug: 'list-patients-test' },
      { id: OTHER_TENANT, name: 'Outra', slug: 'list-patients-test-other' },
    ])
    await db.insert(users).values({ id: USER, email: 'list-patients@test.local', fullName: 'Dra.' })
    await db.insert(patients).values([
      { id: ANA, tenantId: TENANT, fullName: 'Ana', phone: '11999990001', cpf: '123.456.789-00' },
      { id: BIA, tenantId: TENANT, fullName: 'Bia', phone: '11999990002' },
      { id: CAIO, tenantId: TENANT, fullName: 'Caio', phone: '11999990003' },
    ])
    await appointment(ANA, 5, 'scheduled', '14:30')
    await appointment(ANA, 2, 'cancelled')
    await appointment(ANA, -20, 'completed')
    await appointment(ANA, -3, 'no_show')
    // Never marked as attended, but already in the past.
    await appointment(BIA, -60, 'scheduled')
    await appointment(BIA, -5, 'pending_reschedule')
    // Earlier today and never closed: neither next nor a visit yet.
    await appointment(BIA, 0, 'scheduled', '00:00')
    await appointment(CAIO, 1, 'confirmed', '09:00', OTHER_TENANT)
    await appointment(CAIO, -1, 'completed', '09:00', OTHER_TENANT)
  })

  afterAll(async () => {
    await db.delete(appointments).where(inArray(appointments.tenantId, [TENANT, OTHER_TENANT]))
    await db.delete(patients).where(inArray(patients.tenantId, [TENANT, OTHER_TENANT]))
    await db.delete(users).where(inArray(users.id, [USER]))
    await db.delete(tenants).where(inArray(tenants.id, [TENANT, OTHER_TENANT]))
  })

  it('ignores past slots, cancelled, missed and to-reschedule visits and appointments from another clinic', async () => {
    const { data } = await listPatients(TENANT, {})
    expect(data.map((p) => [p.fullName, p.nextAppointmentAt, p.lastVisitDate])).toEqual([
      ['Ana', `${day(5)}T14:30`, day(-20)],
      ['Bia', null, day(-60)],
      ['Caio', null, null],
    ])
  })

  it('sorts by last visit with never-visited patients last', async () => {
    const { data } = await listPatients(TENANT, { sort: 'ultima-visita', direction: 'asc' })
    expect(data.map((p) => p.fullName)).toEqual(['Bia', 'Ana', 'Caio'])
  })

  it('finds a formatted CPF by its digits', async () => {
    const { data } = await listPatients(TENANT, { search: '12345678900' })
    expect(data.map((p) => p.fullName)).toEqual(['Ana'])
  })
})
