import { db } from '@/db/client'
import {
  procedureRecords,
  procedureTypes,
  patients,
  users,
  appointments,
  faceDiagrams,
  diagramPoints,
  productApplications,
  photoAssets,
  consentAcceptances,
  consentTemplates,
} from '@/db/schema'
import { eq, and, desc, isNull, sql, inArray } from 'drizzle-orm'
import type { CreateProcedureInput, UpdateProcedureInput } from '@/validations/procedure'
import { verifyTenantOwnership, verifyUserBelongsToTenant } from './helpers'

// ─── Types ──────────────────────────────────────────────────────────

/**
 * Lifecycle states a `procedure_records.status` row may hold.
 *
 * `executed` was removed in the package + atendimento redesign — the
 * single-row terminal state was split into `in_progress` (one or more sessions
 * recorded, more remaining) and `completed` (all sessions recorded).
 */
export type ProcedureRecordStatus =
  | 'draft'
  | 'planned'
  | 'approved'
  | 'in_progress'
  | 'completed'
  | 'cancelled'

export interface ProcedureWithDetails {
  id: string
  tenantId: string
  patientId: string
  practitionerId: string
  procedureTypeId: string
  appointmentId: string | null
  performedAt: Date | null
  technique: string | null
  clinicalResponse: string | null
  adverseEffects: string | null
  notes: string | null
  followUpDate: string | null
  nextSessionObjectives: string | null
  status: string
  plannedSnapshot: unknown
  approvedAt: Date | null
  cancelledAt: Date | null
  cancellationReason: string | null
  additionalTypeIds: unknown
  financialPlan: unknown
  patientPackageId: string | null
  sessionsTotal: number
  atendimentoId: string | null
  sessionsExecuted: number
  createdAt: Date
  updatedAt: Date
  procedureTypeName: string
  procedureTypeCategory: string
  practitionerName: string
}

export interface ProcedureListItem {
  id: string
  performedAt: Date | null
  status: string
  technique: string | null
  notes: string | null
  financialPlan: unknown
  approvedAt: Date | null
  cancelledAt: Date | null
  cancellationReason: string | null
  sessionsTotal: number
  atendimentoId: string | null
  sessionsExecuted: number
  procedureTypeName: string
  procedureTypeCategory: string
  practitionerName: string
}

// `procedure_sessions` count subquery — used by every projection that surfaces
// a `sessionsExecuted` field. Inlined as a SQL fragment so callers don't have
// to repeat the schema-qualified table name.
const sessionsExecutedSubquery = sql<number>`(
  SELECT COUNT(*)::int FROM floraclin.procedure_sessions ps
  WHERE ps.procedure_record_id = ${procedureRecords.id}
)`

// ─── Queries ────────────────────────────────────────────────────────

export async function createProcedure(
  tenantId: string,
  patientId: string,
  practitionerId: string,
  data: {
    procedureTypeId: string
    additionalTypeIds?: string[]
    appointmentId?: string | null
    technique?: string | null
    clinicalResponse?: string | null
    adverseEffects?: string | null
    notes?: string | null
    followUpDate?: string | null
    nextSessionObjectives?: string | null
    financialPlan?: unknown
    patientPackageId?: string | null
    sessionsTotal?: number
    atendimentoId?: string | null
    status?: 'draft' | 'planned' | 'approved'
  },
  tx: typeof db = db
) {
  // Verify foreign IDs belong to this tenant
  await Promise.all([
    verifyTenantOwnership(tenantId, patients, patientId, 'Patient'),
    verifyTenantOwnership(tenantId, procedureTypes, data.procedureTypeId, 'Procedure type'),
    ...(data.appointmentId
      ? [verifyTenantOwnership(tenantId, appointments, data.appointmentId, 'Appointment')]
      : []),
  ])

  const [record] = await tx
    .insert(procedureRecords)
    .values({
      tenantId,
      patientId,
      practitionerId,
      procedureTypeId: data.procedureTypeId,
      additionalTypeIds: data.additionalTypeIds ?? [],
      appointmentId: data.appointmentId ?? null,
      technique: data.technique ?? null,
      clinicalResponse: data.clinicalResponse ?? null,
      adverseEffects: data.adverseEffects ?? null,
      notes: data.notes ?? null,
      followUpDate: data.followUpDate ?? null,
      nextSessionObjectives: data.nextSessionObjectives ?? null,
      financialPlan: data.financialPlan ?? null,
      patientPackageId: data.patientPackageId ?? null,
      sessionsTotal: data.sessionsTotal ?? 1,
      atendimentoId: data.atendimentoId ?? null,
      status: data.status ?? 'draft',
    })
    .returning()

  return record
}

export async function updateProcedure(
  tenantId: string,
  procedureId: string,
  data: Partial<UpdateProcedureInput>,
  /**
   * Optional draft/planned transition. Only accepts these two values — other
   * statuses (approved, in_progress, completed, cancelled) are reserved for
   * dedicated lifecycle actions. Passing undefined leaves status untouched.
   */
  status: 'draft' | 'planned' | undefined,
  txDb: typeof db = db
) {
  const updateData: Record<string, unknown> = { updatedAt: new Date() }

  if (data.technique !== undefined) updateData.technique = data.technique ?? null
  if (data.clinicalResponse !== undefined) updateData.clinicalResponse = data.clinicalResponse ?? null
  if (data.adverseEffects !== undefined) updateData.adverseEffects = data.adverseEffects ?? null
  if (data.notes !== undefined) updateData.notes = data.notes ?? null
  if (data.followUpDate !== undefined) updateData.followUpDate = data.followUpDate ?? null
  if (data.nextSessionObjectives !== undefined) updateData.nextSessionObjectives = data.nextSessionObjectives ?? null
  if (data.procedureTypeId !== undefined) updateData.procedureTypeId = data.procedureTypeId
  if (data.additionalTypeIds !== undefined) updateData.additionalTypeIds = data.additionalTypeIds ?? []
  if (data.appointmentId !== undefined) updateData.appointmentId = data.appointmentId ?? null
  if (data.financialPlan !== undefined) updateData.financialPlan = data.financialPlan ?? null
  if (status !== undefined) updateData.status = status

  const [updated] = await txDb
    .update(procedureRecords)
    .set(updateData)
    .where(
      and(
        eq(procedureRecords.id, procedureId),
        eq(procedureRecords.tenantId, tenantId),
        isNull(procedureRecords.deletedAt)
      )
    )
    .returning()

  return updated
}

export async function getProcedure(
  tenantId: string,
  procedureId: string
): Promise<ProcedureWithDetails | null> {
  const [record] = await db
    .select({
      id: procedureRecords.id,
      tenantId: procedureRecords.tenantId,
      patientId: procedureRecords.patientId,
      practitionerId: procedureRecords.practitionerId,
      procedureTypeId: procedureRecords.procedureTypeId,
      appointmentId: procedureRecords.appointmentId,
      performedAt: procedureRecords.performedAt,
      technique: procedureRecords.technique,
      clinicalResponse: procedureRecords.clinicalResponse,
      adverseEffects: procedureRecords.adverseEffects,
      notes: procedureRecords.notes,
      followUpDate: procedureRecords.followUpDate,
      nextSessionObjectives: procedureRecords.nextSessionObjectives,
      status: procedureRecords.status,
      plannedSnapshot: procedureRecords.plannedSnapshot,
      approvedAt: procedureRecords.approvedAt,
      cancelledAt: procedureRecords.cancelledAt,
      cancellationReason: procedureRecords.cancellationReason,
      additionalTypeIds: procedureRecords.additionalTypeIds,
      financialPlan: procedureRecords.financialPlan,
      patientPackageId: procedureRecords.patientPackageId,
      sessionsTotal: procedureRecords.sessionsTotal,
      atendimentoId: procedureRecords.atendimentoId,
      sessionsExecuted: sessionsExecutedSubquery,
      createdAt: procedureRecords.createdAt,
      updatedAt: procedureRecords.updatedAt,
      procedureTypeName: procedureTypes.name,
      procedureTypeCategory: procedureTypes.category,
      practitionerName: users.fullName,
    })
    .from(procedureRecords)
    .innerJoin(procedureTypes, eq(procedureRecords.procedureTypeId, procedureTypes.id))
    .innerJoin(users, eq(procedureRecords.practitionerId, users.id))
    .where(
      and(
        eq(procedureRecords.id, procedureId),
        eq(procedureRecords.tenantId, tenantId),
        isNull(procedureRecords.deletedAt)
      )
    )
    .limit(1)

  return record ?? null
}

export async function listProcedures(
  tenantId: string,
  patientId: string
): Promise<ProcedureListItem[]> {
  const records = await db
    .select({
      id: procedureRecords.id,
      performedAt: procedureRecords.performedAt,
      status: procedureRecords.status,
      technique: procedureRecords.technique,
      notes: procedureRecords.notes,
      financialPlan: procedureRecords.financialPlan,
      approvedAt: procedureRecords.approvedAt,
      cancelledAt: procedureRecords.cancelledAt,
      cancellationReason: procedureRecords.cancellationReason,
      sessionsTotal: procedureRecords.sessionsTotal,
      atendimentoId: procedureRecords.atendimentoId,
      sessionsExecuted: sessionsExecutedSubquery,
      procedureTypeName: procedureTypes.name,
      procedureTypeCategory: procedureTypes.category,
      practitionerName: users.fullName,
    })
    .from(procedureRecords)
    .innerJoin(procedureTypes, eq(procedureRecords.procedureTypeId, procedureTypes.id))
    .innerJoin(users, eq(procedureRecords.practitionerId, users.id))
    .where(
      and(
        eq(procedureRecords.tenantId, tenantId),
        eq(procedureRecords.patientId, patientId),
        isNull(procedureRecords.deletedAt)
      )
    )
    .orderBy(
      sql`CASE ${procedureRecords.status}
        WHEN 'draft' THEN 1
        WHEN 'planned' THEN 2
        WHEN 'approved' THEN 3
        WHEN 'in_progress' THEN 4
        WHEN 'completed' THEN 5
        WHEN 'cancelled' THEN 6
        ELSE 7
      END`,
      desc(procedureRecords.performedAt)
    )

  return records
}

export async function listProcedureTypes(tenantId: string) {
  return db
    .select()
    .from(procedureTypes)
    .where(
      and(
        eq(procedureTypes.tenantId, tenantId),
        eq(procedureTypes.isActive, true),
        isNull(procedureTypes.deletedAt)
      )
    )
    .orderBy(procedureTypes.name)
}

export async function getConsentAcceptancesForProcedure(
  tenantId: string,
  procedureRecordId: string
) {
  return db
    .select({
      id: consentAcceptances.id,
      acceptedAt: consentAcceptances.acceptedAt,
      acceptanceMethod: consentAcceptances.acceptanceMethod,
      templateTitle: consentTemplates.title,
      templateType: consentTemplates.type,
    })
    .from(consentAcceptances)
    .innerJoin(consentTemplates, eq(consentAcceptances.consentTemplateId, consentTemplates.id))
    .where(
      and(
        eq(consentAcceptances.tenantId, tenantId),
        eq(consentAcceptances.procedureRecordId, procedureRecordId)
      )
    )
    .orderBy(desc(consentAcceptances.acceptedAt))
}

export async function getLatestConsentForPatientType(
  tenantId: string,
  patientId: string,
  consentType: string
) {
  const [acceptance] = await db
    .select({
      id: consentAcceptances.id,
      acceptedAt: consentAcceptances.acceptedAt,
      acceptanceMethod: consentAcceptances.acceptanceMethod,
      templateTitle: consentTemplates.title,
      templateType: consentTemplates.type,
    })
    .from(consentAcceptances)
    .innerJoin(consentTemplates, eq(consentAcceptances.consentTemplateId, consentTemplates.id))
    .where(
      and(
        eq(consentAcceptances.tenantId, tenantId),
        eq(consentAcceptances.patientId, patientId),
        eq(consentTemplates.type, consentType)
      )
    )
    .orderBy(desc(consentAcceptances.acceptedAt))
    .limit(1)

  return acceptance ?? null
}

// ─── Lifecycle Queries ─────────────────────────────────────────────

export async function approveProcedure(
  tenantId: string,
  procedureId: string,
  plannedSnapshot: unknown,
  txDb: typeof db = db
) {
  const [updated] = await txDb
    .update(procedureRecords)
    .set({
      status: 'approved',
      plannedSnapshot,
      approvedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(procedureRecords.id, procedureId),
        eq(procedureRecords.tenantId, tenantId),
        eq(procedureRecords.status, 'planned'),
        isNull(procedureRecords.deletedAt)
      )
    )
    .returning()

  return updated
}

export async function cancelProcedure(
  tenantId: string,
  procedureId: string,
  reason: string,
  txDb: typeof db = db
) {
  const [updated] = await txDb
    .update(procedureRecords)
    .set({
      status: 'cancelled',
      cancelledAt: new Date(),
      cancellationReason: reason,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(procedureRecords.id, procedureId),
        eq(procedureRecords.tenantId, tenantId),
        inArray(procedureRecords.status, ['draft', 'planned', 'approved']),
        isNull(procedureRecords.deletedAt)
      )
    )
    .returning()

  return updated
}

export async function getLatestOpenProcedure(
  tenantId: string,
  patientId: string
): Promise<ProcedureWithDetails | null> {
  const [record] = await db
    .select({
      id: procedureRecords.id,
      tenantId: procedureRecords.tenantId,
      patientId: procedureRecords.patientId,
      practitionerId: procedureRecords.practitionerId,
      procedureTypeId: procedureRecords.procedureTypeId,
      appointmentId: procedureRecords.appointmentId,
      performedAt: procedureRecords.performedAt,
      technique: procedureRecords.technique,
      clinicalResponse: procedureRecords.clinicalResponse,
      adverseEffects: procedureRecords.adverseEffects,
      notes: procedureRecords.notes,
      followUpDate: procedureRecords.followUpDate,
      nextSessionObjectives: procedureRecords.nextSessionObjectives,
      status: procedureRecords.status,
      plannedSnapshot: procedureRecords.plannedSnapshot,
      approvedAt: procedureRecords.approvedAt,
      cancelledAt: procedureRecords.cancelledAt,
      cancellationReason: procedureRecords.cancellationReason,
      additionalTypeIds: procedureRecords.additionalTypeIds,
      financialPlan: procedureRecords.financialPlan,
      patientPackageId: procedureRecords.patientPackageId,
      sessionsTotal: procedureRecords.sessionsTotal,
      atendimentoId: procedureRecords.atendimentoId,
      sessionsExecuted: sessionsExecutedSubquery,
      createdAt: procedureRecords.createdAt,
      updatedAt: procedureRecords.updatedAt,
      procedureTypeName: procedureTypes.name,
      procedureTypeCategory: procedureTypes.category,
      practitionerName: users.fullName,
    })
    .from(procedureRecords)
    .innerJoin(procedureTypes, eq(procedureRecords.procedureTypeId, procedureTypes.id))
    .innerJoin(users, eq(procedureRecords.practitionerId, users.id))
    .where(
      and(
        eq(procedureRecords.tenantId, tenantId),
        eq(procedureRecords.patientId, patientId),
        inArray(procedureRecords.status, ['draft', 'planned', 'approved', 'in_progress']),
        isNull(procedureRecords.deletedAt)
      )
    )
    .orderBy(desc(procedureRecords.createdAt))
    .limit(1)

  return record ?? null
}

/** @deprecated Use getLatestOpenProcedure */
export const getLatestNonExecutedProcedure = getLatestOpenProcedure
