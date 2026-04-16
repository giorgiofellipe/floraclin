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

export interface ProcedureWithDetails {
  id: string
  tenantId: string
  patientId: string
  practitionerId: string
  procedureTypeId: string
  appointmentId: string | null
  performedAt: Date
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
  createdAt: Date
  updatedAt: Date
  procedureTypeName: string
  procedureTypeCategory: string
  practitionerName: string
}

export interface ProcedureListItem {
  id: string
  performedAt: Date
  status: string
  technique: string | null
  notes: string | null
  financialPlan: unknown
  approvedAt: Date | null
  cancelledAt: Date | null
  cancellationReason: string | null
  procedureTypeName: string
  procedureTypeCategory: string
  practitionerName: string
}

// ─── Queries ────────────────────────────────────────────────────────

export async function createProcedure(
  tenantId: string,
  practitionerId: string,
  data: CreateProcedureInput,
  status: 'draft' | 'planned',
  txDb: typeof db = db
) {
  // Verify foreign IDs belong to this tenant
  await Promise.all([
    verifyTenantOwnership(tenantId, patients, data.patientId, 'Patient'),
    verifyTenantOwnership(tenantId, procedureTypes, data.procedureTypeId, 'Procedure type'),
    ...(data.appointmentId
      ? [verifyTenantOwnership(tenantId, appointments, data.appointmentId, 'Appointment')]
      : []),
  ])

  const [record] = await txDb
    .insert(procedureRecords)
    .values({
      tenantId,
      patientId: data.patientId,
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
      status,
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
   * statuses (approved, executed, cancelled) are reserved for dedicated
   * lifecycle actions. Passing undefined leaves status untouched.
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
        WHEN 'executed' THEN 4
        WHEN 'cancelled' THEN 5
        ELSE 6
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

export async function executeProcedure(
  tenantId: string,
  procedureId: string,
  data: {
    technique?: string | null
    clinicalResponse?: string | null
    adverseEffects?: string | null
    notes?: string | null
    followUpDate?: string | null
    nextSessionObjectives?: string | null
  },
  txDb: typeof db = db
) {
  const [updated] = await txDb
    .update(procedureRecords)
    .set({
      status: 'executed',
      performedAt: new Date(),
      technique: data.technique ?? null,
      clinicalResponse: data.clinicalResponse ?? null,
      adverseEffects: data.adverseEffects ?? null,
      notes: data.notes ?? null,
      followUpDate: data.followUpDate ?? null,
      nextSessionObjectives: data.nextSessionObjectives ?? null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(procedureRecords.id, procedureId),
        eq(procedureRecords.tenantId, tenantId),
        eq(procedureRecords.status, 'approved'),
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

export async function getLatestNonExecutedProcedure(
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
        inArray(procedureRecords.status, ['draft', 'planned', 'approved']),
        isNull(procedureRecords.deletedAt)
      )
    )
    .orderBy(desc(procedureRecords.createdAt))
    .limit(1)

  return record ?? null
}
