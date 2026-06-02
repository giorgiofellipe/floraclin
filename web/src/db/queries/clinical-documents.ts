import { db } from '@/db/client'
import {
  clinicalDocumentTemplates,
  clinicalDocuments,
  patients,
  tenants,
  users,
} from '@/db/schema'
import { and, eq, isNull, desc, asc } from 'drizzle-orm'
import type {
  ClinicalDocumentKind,
  ProfessionalSnapshot,
} from '@/validations/clinical-document'

// ─── TEMPLATES ──────────────────────────────────────────────────────

export type ClinicalDocumentTemplate = typeof clinicalDocumentTemplates.$inferSelect

export async function listClinicalDocumentTemplates(
  tenantId: string,
  options?: { kind?: ClinicalDocumentKind; includeInactive?: boolean },
): Promise<ClinicalDocumentTemplate[]> {
  const conditions = [
    eq(clinicalDocumentTemplates.tenantId, tenantId),
    isNull(clinicalDocumentTemplates.deletedAt),
  ]
  if (options?.kind) {
    conditions.push(eq(clinicalDocumentTemplates.kind, options.kind))
  }
  if (!options?.includeInactive) {
    conditions.push(eq(clinicalDocumentTemplates.isActive, true))
  }

  return db
    .select()
    .from(clinicalDocumentTemplates)
    .where(and(...conditions))
    .orderBy(asc(clinicalDocumentTemplates.kind), asc(clinicalDocumentTemplates.name))
}

export async function getClinicalDocumentTemplate(
  tenantId: string,
  id: string,
): Promise<ClinicalDocumentTemplate | null> {
  const [row] = await db
    .select()
    .from(clinicalDocumentTemplates)
    .where(
      and(
        eq(clinicalDocumentTemplates.id, id),
        eq(clinicalDocumentTemplates.tenantId, tenantId),
        isNull(clinicalDocumentTemplates.deletedAt),
      ),
    )
    .limit(1)
  return row ?? null
}

export async function createClinicalDocumentTemplate(args: {
  tenantId: string
  createdBy: string
  kind: ClinicalDocumentKind
  name: string
  body: string
  isActive?: boolean
}): Promise<ClinicalDocumentTemplate> {
  const [row] = await db
    .insert(clinicalDocumentTemplates)
    .values({
      tenantId: args.tenantId,
      createdBy: args.createdBy,
      kind: args.kind,
      name: args.name,
      body: args.body,
      isActive: args.isActive ?? true,
    })
    .returning()
  return row
}

export async function updateClinicalDocumentTemplate(
  tenantId: string,
  id: string,
  data: Partial<{ kind: ClinicalDocumentKind; name: string; body: string; isActive: boolean }>,
): Promise<ClinicalDocumentTemplate | null> {
  const updateData: Record<string, unknown> = { updatedAt: new Date() }
  if (data.kind !== undefined) updateData.kind = data.kind
  if (data.name !== undefined) updateData.name = data.name
  if (data.body !== undefined) updateData.body = data.body
  if (data.isActive !== undefined) updateData.isActive = data.isActive

  const [row] = await db
    .update(clinicalDocumentTemplates)
    .set(updateData)
    .where(
      and(
        eq(clinicalDocumentTemplates.id, id),
        eq(clinicalDocumentTemplates.tenantId, tenantId),
        isNull(clinicalDocumentTemplates.deletedAt),
      ),
    )
    .returning()
  return row ?? null
}

export async function softDeleteClinicalDocumentTemplate(
  tenantId: string,
  id: string,
): Promise<boolean> {
  const [row] = await db
    .update(clinicalDocumentTemplates)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(clinicalDocumentTemplates.id, id),
        eq(clinicalDocumentTemplates.tenantId, tenantId),
        isNull(clinicalDocumentTemplates.deletedAt),
      ),
    )
    .returning()
  return !!row
}

// ─── DOCUMENTS ──────────────────────────────────────────────────────

export type ClinicalDocument = typeof clinicalDocuments.$inferSelect

export interface ClinicalDocumentListRow {
  id: string
  kind: string
  title: string
  issuedAt: Date
  deliveredVia: string
  practitionerId: string
  practitionerName: string
  templateId: string | null
  whatsappMessageId: string | null
  storagePath: string | null
}

export async function listClinicalDocumentsForPatient(
  tenantId: string,
  patientId: string,
): Promise<ClinicalDocumentListRow[]> {
  const rows = await db
    .select({
      id: clinicalDocuments.id,
      kind: clinicalDocuments.kind,
      title: clinicalDocuments.title,
      issuedAt: clinicalDocuments.issuedAt,
      deliveredVia: clinicalDocuments.deliveredVia,
      practitionerId: clinicalDocuments.practitionerId,
      practitionerName: users.fullName,
      templateId: clinicalDocuments.templateId,
      whatsappMessageId: clinicalDocuments.whatsappMessageId,
      storagePath: clinicalDocuments.storagePath,
    })
    .from(clinicalDocuments)
    .innerJoin(users, eq(users.id, clinicalDocuments.practitionerId))
    .where(
      and(
        eq(clinicalDocuments.tenantId, tenantId),
        eq(clinicalDocuments.patientId, patientId),
      ),
    )
    .orderBy(desc(clinicalDocuments.issuedAt))

  return rows
}

export interface ClinicalDocumentWithContext {
  id: string
  tenantId: string
  patientId: string
  practitionerId: string
  kind: 'receita' | 'atestado'
  title: string
  body: string
  templateId: string | null
  professionalSnapshot: ProfessionalSnapshot
  issuedAt: Date
  deliveredVia: string
  whatsappMessageId: string | null
  storagePath: string | null
  verificationCode: string | null
  createdAt: Date
  updatedAt: Date
  // joined
  patient: {
    id: string
    fullName: string
    cpf: string | null
    birthDate: string | null
    phone: string
  }
  tenant: {
    id: string
    name: string
    phone: string | null
    email: string | null
    logoUrl: string | null
    address: Record<string, unknown> | null
  }
}

export async function getClinicalDocumentWithContext(
  tenantId: string,
  id: string,
): Promise<ClinicalDocumentWithContext | null> {
  const [row] = await db
    .select({
      doc: clinicalDocuments,
      patient: {
        id: patients.id,
        fullName: patients.fullName,
        cpf: patients.cpf,
        birthDate: patients.birthDate,
        phone: patients.phone,
      },
      tenant: {
        id: tenants.id,
        name: tenants.name,
        phone: tenants.phone,
        email: tenants.email,
        logoUrl: tenants.logoUrl,
        address: tenants.address,
      },
    })
    .from(clinicalDocuments)
    .innerJoin(patients, eq(patients.id, clinicalDocuments.patientId))
    .innerJoin(tenants, eq(tenants.id, clinicalDocuments.tenantId))
    .where(
      and(
        eq(clinicalDocuments.id, id),
        eq(clinicalDocuments.tenantId, tenantId),
      ),
    )
    .limit(1)

  if (!row) return null

  const snapshot = row.doc.professionalSnapshot as ProfessionalSnapshot
  const kind = row.doc.kind as 'receita' | 'atestado'

  return {
    id: row.doc.id,
    tenantId: row.doc.tenantId,
    patientId: row.doc.patientId,
    practitionerId: row.doc.practitionerId,
    kind,
    title: row.doc.title,
    body: row.doc.body,
    templateId: row.doc.templateId,
    professionalSnapshot: snapshot,
    issuedAt: row.doc.issuedAt,
    deliveredVia: row.doc.deliveredVia,
    whatsappMessageId: row.doc.whatsappMessageId,
    storagePath: row.doc.storagePath,
    verificationCode: row.doc.verificationCode,
    createdAt: row.doc.createdAt,
    updatedAt: row.doc.updatedAt,
    patient: row.patient,
    tenant: row.tenant as ClinicalDocumentWithContext['tenant'],
  }
}

export async function insertClinicalDocument(args: {
  tenantId: string
  patientId: string
  practitionerId: string
  kind: ClinicalDocumentKind
  title: string
  body: string
  templateId: string | null
  professionalSnapshot: ProfessionalSnapshot
  verificationCode?: string | null
}): Promise<ClinicalDocument> {
  const [row] = await db
    .insert(clinicalDocuments)
    .values({
      tenantId: args.tenantId,
      patientId: args.patientId,
      practitionerId: args.practitionerId,
      kind: args.kind,
      title: args.title,
      body: args.body,
      templateId: args.templateId,
      professionalSnapshot: args.professionalSnapshot,
      verificationCode: args.verificationCode ?? null,
      deliveredVia: 'pending',
    })
    .returning()
  return row
}

export async function updateDeliveryStatus(
  tenantId: string,
  id: string,
  data: { deliveredVia: string; whatsappMessageId?: string | null; storagePath?: string | null },
): Promise<void> {
  const updateData: Record<string, unknown> = {
    deliveredVia: data.deliveredVia,
    updatedAt: new Date(),
  }
  if (data.whatsappMessageId !== undefined) updateData.whatsappMessageId = data.whatsappMessageId
  if (data.storagePath !== undefined) updateData.storagePath = data.storagePath

  await db
    .update(clinicalDocuments)
    .set(updateData)
    .where(
      and(
        eq(clinicalDocuments.id, id),
        eq(clinicalDocuments.tenantId, tenantId),
      ),
    )
}

export async function findClinicalDocumentByVerificationCode(code: string) {
  const [row] = await db
    .select({
      id: clinicalDocuments.id,
      kind: clinicalDocuments.kind,
      title: clinicalDocuments.title,
      body: clinicalDocuments.body,
      issuedAt: clinicalDocuments.issuedAt,
      verificationCode: clinicalDocuments.verificationCode,
      professionalSnapshot: clinicalDocuments.professionalSnapshot,
      patientName: patients.fullName,
      patientCpf: patients.cpf,
      patientBirthDate: patients.birthDate,
      tenantName: tenants.name,
      tenantPhone: tenants.phone,
      tenantEmail: tenants.email,
      tenantLogoUrl: tenants.logoUrl,
      tenantAddress: tenants.address,
    })
    .from(clinicalDocuments)
    .innerJoin(patients, eq(patients.id, clinicalDocuments.patientId))
    .innerJoin(tenants, eq(tenants.id, clinicalDocuments.tenantId))
    .where(eq(clinicalDocuments.verificationCode, code))
    .limit(1)

  return row ?? null
}
