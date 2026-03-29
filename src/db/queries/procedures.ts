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
import { eq, and, desc, isNull } from 'drizzle-orm'
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
  procedureTypeName: string
  procedureTypeCategory: string
  practitionerName: string
}

// ─── Queries ────────────────────────────────────────────────────────

export async function createProcedure(
  tenantId: string,
  practitionerId: string,
  data: CreateProcedureInput,
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
      status: 'completed',
      performedAt: new Date(),
    })
    .returning()

  return record
}

export async function updateProcedure(
  tenantId: string,
  procedureId: string,
  data: Partial<UpdateProcedureInput>,
  txDb: typeof db = db
) {
  const updateData: Record<string, unknown> = { updatedAt: new Date() }

  if (data.technique !== undefined) updateData.technique = data.technique ?? null
  if (data.clinicalResponse !== undefined) updateData.clinicalResponse = data.clinicalResponse ?? null
  if (data.adverseEffects !== undefined) updateData.adverseEffects = data.adverseEffects ?? null
  if (data.notes !== undefined) updateData.notes = data.notes ?? null
  if (data.followUpDate !== undefined) updateData.followUpDate = data.followUpDate ?? null
  if (data.nextSessionObjectives !== undefined) updateData.nextSessionObjectives = data.nextSessionObjectives ?? null
  if (data.status !== undefined) updateData.status = data.status
  if (data.procedureTypeId !== undefined) updateData.procedureTypeId = data.procedureTypeId
  if (data.additionalTypeIds !== undefined) updateData.additionalTypeIds = data.additionalTypeIds ?? []
  if (data.appointmentId !== undefined) updateData.appointmentId = data.appointmentId ?? null

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
    .orderBy(desc(procedureRecords.performedAt))

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
