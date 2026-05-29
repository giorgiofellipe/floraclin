import { db } from '@/db/client'
import {
  procedureRecords,
  procedureTypes,
  patients,
  users,
} from '@/db/schema'
import { and, eq, inArray, isNull, or, sql, asc } from 'drizzle-orm'
import { brToday } from '@/lib/dates'

export interface OpenPlanejamentoRow {
  id: string
  patientId: string
  patientName: string
  patientPhone: string
  procedureTypeId: string
  procedureTypeName: string
  practitionerId: string
  practitionerName: string
  status: string
  performedAt: Date | null
  followUpDate: string | null
  totalAmount: string | null
  createdAt: Date
  lastContactedAt: Date | null
  snoozedUntil: string | null
}

export interface ListOpenPlanejamentosArgs {
  tenantId: string
  practitionerId?: string
  procedureTypeId?: string
  includeSnoozed?: boolean
  limit?: number
}

/**
 * Lists open planejamentos — procedure records in 'planned' or 'approved'
 * status that have not been delivered yet. Sorted stalest-first using
 * COALESCE(last_contacted_at, created_at) ASC so the procedures most in need
 * of follow-up surface to the top.
 *
 * Snoozed rows (followup_snoozed_until > today) are excluded unless
 * includeSnoozed = true.
 *
 * Returns the joined patient name + phone, procedure type name, and
 * practitioner name so the UI can render the row without follow-up queries.
 */
export async function listOpenPlanejamentos(
  args: ListOpenPlanejamentosArgs,
): Promise<OpenPlanejamentoRow[]> {
  const today = brToday()
  const limit = args.limit ?? 200

  const filters = [
    eq(procedureRecords.tenantId, args.tenantId),
    isNull(procedureRecords.deletedAt),
    inArray(procedureRecords.status, ['planned', 'approved']),
  ]

  if (args.practitionerId) {
    filters.push(eq(procedureRecords.practitionerId, args.practitionerId))
  }

  if (args.procedureTypeId) {
    filters.push(eq(procedureRecords.procedureTypeId, args.procedureTypeId))
  }

  if (!args.includeSnoozed) {
    const notSnoozed = or(
      isNull(procedureRecords.followupSnoozedUntil),
      sql`${procedureRecords.followupSnoozedUntil} <= ${today}`,
    )
    if (notSnoozed) filters.push(notSnoozed)
  }

  const rows = await db
    .select({
      id: procedureRecords.id,
      patientId: procedureRecords.patientId,
      patientName: patients.fullName,
      patientPhone: patients.phone,
      procedureTypeId: procedureRecords.procedureTypeId,
      procedureTypeName: procedureTypes.name,
      practitionerId: procedureRecords.practitionerId,
      practitionerName: users.fullName,
      status: procedureRecords.status,
      performedAt: procedureRecords.performedAt,
      followUpDate: procedureRecords.followUpDate,
      financialPlan: procedureRecords.financialPlan,
      createdAt: procedureRecords.createdAt,
      lastContactedAt: procedureRecords.lastContactedAt,
      snoozedUntil: procedureRecords.followupSnoozedUntil,
    })
    .from(procedureRecords)
    .innerJoin(patients, eq(procedureRecords.patientId, patients.id))
    .innerJoin(
      procedureTypes,
      eq(procedureRecords.procedureTypeId, procedureTypes.id),
    )
    .innerJoin(users, eq(procedureRecords.practitionerId, users.id))
    .where(and(...filters))
    .orderBy(
      asc(
        sql`COALESCE(${procedureRecords.lastContactedAt}, ${procedureRecords.createdAt})`,
      ),
    )
    .limit(limit)

  return rows.map((row) => {
    const plan =
      row.financialPlan && typeof row.financialPlan === 'object'
        ? (row.financialPlan as { totalAmount?: number | string | null })
        : null
    const totalAmount =
      plan?.totalAmount !== undefined && plan?.totalAmount !== null
        ? String(plan.totalAmount)
        : null

    return {
      id: row.id,
      patientId: row.patientId,
      patientName: row.patientName,
      patientPhone: row.patientPhone,
      procedureTypeId: row.procedureTypeId,
      procedureTypeName: row.procedureTypeName,
      practitionerId: row.practitionerId,
      practitionerName: row.practitionerName,
      status: row.status,
      performedAt: row.performedAt,
      followUpDate: row.followUpDate,
      totalAmount,
      createdAt: row.createdAt,
      lastContactedAt: row.lastContactedAt,
      snoozedUntil: row.snoozedUntil,
    }
  })
}
