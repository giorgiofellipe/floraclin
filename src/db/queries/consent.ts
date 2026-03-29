import { db } from '@/db/client'
import { consentTemplates, consentAcceptances, patients, procedureRecords } from '@/db/schema'
import { eq, and, desc } from 'drizzle-orm'
import { withTransaction } from '@/lib/tenant'
import type { ConsentTemplateInput, ConsentAcceptanceInput } from '@/validations/consent'
import { verifyTenantOwnership } from './helpers'

// SHA-256 hash using Web Crypto API
async function hashContent(content: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(content)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
}

export async function listConsentTemplates(tenantId: string) {
  const templates = await db
    .select()
    .from(consentTemplates)
    .where(
      and(
        eq(consentTemplates.tenantId, tenantId),
        eq(consentTemplates.isActive, true)
      )
    )
    .orderBy(consentTemplates.type, desc(consentTemplates.version))

  // Group by type
  const grouped = templates.reduce(
    (acc, template) => {
      if (!acc[template.type]) {
        acc[template.type] = []
      }
      acc[template.type].push(template)
      return acc
    },
    {} as Record<string, typeof templates>
  )

  return grouped
}

export async function getActiveConsentForType(tenantId: string, type: string) {
  const [template] = await db
    .select()
    .from(consentTemplates)
    .where(
      and(
        eq(consentTemplates.tenantId, tenantId),
        eq(consentTemplates.type, type),
        eq(consentTemplates.isActive, true)
      )
    )
    .orderBy(desc(consentTemplates.version))
    .limit(1)

  return template ?? null
}

export async function getConsentTemplateById(tenantId: string, templateId: string) {
  const [template] = await db
    .select()
    .from(consentTemplates)
    .where(
      and(
        eq(consentTemplates.id, templateId),
        eq(consentTemplates.tenantId, tenantId)
      )
    )
    .limit(1)

  return template ?? null
}

export async function createConsentTemplate(tenantId: string, data: ConsentTemplateInput) {
  const [template] = await db
    .insert(consentTemplates)
    .values({
      tenantId,
      type: data.type,
      title: data.title,
      content: data.content,
      version: 1,
      isActive: true,
    })
    .returning()

  return template
}

export async function updateConsentTemplate(
  tenantId: string,
  templateId: string,
  data: { title?: string; content: string }
) {
  // Get existing template
  const existing = await getConsentTemplateById(tenantId, templateId)
  if (!existing) {
    throw new Error('Termo não encontrado')
  }

  return withTransaction(async (tx) => {
    // Deactivate old version
    await tx
      .update(consentTemplates)
      .set({ isActive: false, updatedAt: new Date() })
      .where(
        and(
          eq(consentTemplates.id, templateId),
          eq(consentTemplates.tenantId, tenantId)
        )
      )

    // Create new version
    const [newTemplate] = await tx
      .insert(consentTemplates)
      .values({
        tenantId,
        type: existing.type,
        title: data.title ?? existing.title,
        content: data.content,
        version: existing.version + 1,
        isActive: true,
      })
      .returning()

    return newTemplate
  })
}

export async function acceptConsent(
  tenantId: string,
  data: ConsentAcceptanceInput,
  meta: { ipAddress?: string; userAgent?: string; renderedContent?: string }
) {
  // Verify foreign IDs belong to this tenant
  await Promise.all([
    verifyTenantOwnership(tenantId, patients, data.patientId, 'Patient'),
    ...(data.procedureRecordId
      ? [verifyTenantOwnership(tenantId, procedureRecords, data.procedureRecordId, 'Procedure record')]
      : []),
  ])

  // Load the template to get the content for snapshot and hash
  const template = await getConsentTemplateById(tenantId, data.consentTemplateId)
  if (!template) {
    throw new Error('Termo não encontrado')
  }

  // For service contracts, use the rendered (interpolated) text the patient actually read
  // instead of the raw template with placeholders
  const snapshotContent = (template.type === 'service_contract' && meta.renderedContent)
    ? meta.renderedContent
    : template.content

  // Hash the actual content the patient saw
  const contentHash = await hashContent(snapshotContent)

  const [acceptance] = await db
    .insert(consentAcceptances)
    .values({
      tenantId,
      patientId: data.patientId,
      consentTemplateId: data.consentTemplateId,
      procedureRecordId: data.procedureRecordId ?? null,
      acceptanceMethod: data.acceptanceMethod,
      signatureData: data.signatureData ?? null,
      contentHash,
      contentSnapshot: snapshotContent,
      acceptedAt: new Date(),
      ipAddress: meta.ipAddress ?? null,
      userAgent: meta.userAgent ?? null,
    })
    .returning()

  return acceptance
}

export async function getConsentHistory(tenantId: string, patientId: string) {
  const history = await db
    .select({
      id: consentAcceptances.id,
      acceptanceMethod: consentAcceptances.acceptanceMethod,
      signatureData: consentAcceptances.signatureData,
      contentHash: consentAcceptances.contentHash,
      contentSnapshot: consentAcceptances.contentSnapshot,
      acceptedAt: consentAcceptances.acceptedAt,
      procedureRecordId: consentAcceptances.procedureRecordId,
      templateTitle: consentTemplates.title,
      templateType: consentTemplates.type,
      templateVersion: consentTemplates.version,
    })
    .from(consentAcceptances)
    .innerJoin(
      consentTemplates,
      eq(consentAcceptances.consentTemplateId, consentTemplates.id)
    )
    .where(
      and(
        eq(consentAcceptances.tenantId, tenantId),
        eq(consentAcceptances.patientId, patientId)
      )
    )
    .orderBy(desc(consentAcceptances.acceptedAt))

  return history
}

export async function getConsentForProcedure(
  tenantId: string,
  patientId: string,
  procedureRecordId: string,
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
        eq(consentAcceptances.procedureRecordId, procedureRecordId),
        eq(consentTemplates.type, consentType)
      )
    )
    .orderBy(desc(consentAcceptances.acceptedAt))
    .limit(1)

  return acceptance ?? null
}

export async function getAllTemplateVersions(tenantId: string, type: string) {
  return db
    .select()
    .from(consentTemplates)
    .where(
      and(
        eq(consentTemplates.tenantId, tenantId),
        eq(consentTemplates.type, type)
      )
    )
    .orderBy(desc(consentTemplates.version))
}
