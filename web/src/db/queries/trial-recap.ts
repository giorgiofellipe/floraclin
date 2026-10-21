import { sql } from 'drizzle-orm'
import { db } from '@/db/client'
import { rowsFromExecuteResult } from '@/db/queries/admin-tenants'

/**
 * What a clinic built during its trial, for the "your trial ends" modal, the
 * expired paywall and the last-day email: the work they keep by subscribing.
 * One round trip of tenant-scoped counts; trial clinics are small and every
 * table here is indexed by tenant.
 */
export interface TrialRecap {
  patients: number
  appointments: number
  procedureRecords: number
  photos: number
  diagrams: number
}

interface RecapRow {
  patients: number | string
  appointments: number | string
  procedure_records: number | string
  photos: number | string
  diagrams: number | string
}

export async function getTrialRecap(tenantId: string): Promise<TrialRecap> {
  const result = await db.execute(sql`
    select
      (select count(*) from floraclin.patients where tenant_id = ${tenantId} and deleted_at is null) as patients,
      (select count(*) from floraclin.appointments where tenant_id = ${tenantId} and deleted_at is null) as appointments,
      (select count(*) from floraclin.procedure_records where tenant_id = ${tenantId} and deleted_at is null) as procedure_records,
      (select count(*) from floraclin.photo_assets where tenant_id = ${tenantId} and deleted_at is null) as photos,
      (select count(*) from floraclin.face_diagrams fd
         join floraclin.procedure_records pr on pr.id = fd.procedure_record_id and pr.deleted_at is null
        where fd.tenant_id = ${tenantId}) as diagrams
  `)
  const [row] = rowsFromExecuteResult<RecapRow>(result)
  return {
    patients: Number(row?.patients ?? 0),
    appointments: Number(row?.appointments ?? 0),
    procedureRecords: Number(row?.procedure_records ?? 0),
    photos: Number(row?.photos ?? 0),
    diagrams: Number(row?.diagrams ?? 0),
  }
}

/**
 * Whether the clinic "used" its trial (see `usedTrial`): at least one
 * non-deleted patient and one non-deleted appointment. Two indexed EXISTS,
 * for the win-back offer, which only goes to clinics that got going.
 */
export async function getTrialUsage(tenantId: string): Promise<{ hasPatient: boolean; hasAppointment: boolean }> {
  const result = await db.execute(sql`
    select
      exists (select 1 from floraclin.patients where tenant_id = ${tenantId} and deleted_at is null) as has_patient,
      exists (select 1 from floraclin.appointments where tenant_id = ${tenantId} and deleted_at is null) as has_appointment
  `)
  const [row] = rowsFromExecuteResult<{ has_patient: boolean; has_appointment: boolean }>(result)
  return { hasPatient: row?.has_patient === true, hasAppointment: row?.has_appointment === true }
}
