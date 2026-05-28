import { db } from '@/db/client'
import {
  packageTemplates,
  packageTemplateLines,
  patientPackages,
  patientPackageLines,
  procedureRecords,
  procedureTypes,
} from '@/db/schema'
import { and, eq, isNull, sql, inArray, asc, desc } from 'drizzle-orm'
import { brToday } from '@/lib/dates'

// ─── Types ──────────────────────────────────────────────────────────

export interface PackageTemplateLine {
  id: string
  templateId: string
  procedureTypeId: string
  procedureTypeName: string
  sessionsCount: number
  sortOrder: number
}

export interface PackageTemplate {
  id: string
  tenantId: string
  name: string
  description: string | null
  defaultPrice: string | null
  validityMonths: number | null
  isActive: boolean
  createdAt: Date
  updatedAt: Date
  deletedAt: Date | null
  lines: PackageTemplateLine[]
}

export interface PatientPackageLineWithConsumption {
  id: string
  patientPackageId: string
  procedureTypeId: string
  procedureTypeName: string
  sessionsTotal: number
  sortOrder: number
  consumedCount: number
  executedCount: number
}

export interface PatientPackageWithConsumption {
  id: string
  tenantId: string
  patientId: string
  templateId: string | null
  name: string
  totalAmount: string
  purchasedAt: string
  expiresAt: string | null
  status: string
  cancelledAt: Date | null
  cancelReason: string | null
  financialEntryId: string
  soldBy: string
  createdAt: Date
  updatedAt: Date
  lines: PatientPackageLineWithConsumption[]
}

// ─── PACKAGE TEMPLATES ──────────────────────────────────────────────

export async function listPackageTemplates(tenantId: string): Promise<PackageTemplate[]> {
  const templates = await db
    .select()
    .from(packageTemplates)
    .where(
      and(
        eq(packageTemplates.tenantId, tenantId),
        isNull(packageTemplates.deletedAt),
      ),
    )
    .orderBy(asc(packageTemplates.name))

  if (templates.length === 0) return []

  const templateIds = templates.map((t) => t.id)
  const lines = await db
    .select({
      id: packageTemplateLines.id,
      templateId: packageTemplateLines.templateId,
      procedureTypeId: packageTemplateLines.procedureTypeId,
      procedureTypeName: procedureTypes.name,
      sessionsCount: packageTemplateLines.sessionsCount,
      sortOrder: packageTemplateLines.sortOrder,
    })
    .from(packageTemplateLines)
    .innerJoin(procedureTypes, eq(procedureTypes.id, packageTemplateLines.procedureTypeId))
    .where(inArray(packageTemplateLines.templateId, templateIds))
    .orderBy(asc(packageTemplateLines.sortOrder))

  const linesByTemplate = new Map<string, PackageTemplateLine[]>()
  for (const line of lines) {
    const arr = linesByTemplate.get(line.templateId) ?? []
    arr.push(line)
    linesByTemplate.set(line.templateId, arr)
  }

  return templates.map((t) => ({
    ...t,
    lines: linesByTemplate.get(t.id) ?? [],
  }))
}

export async function getPackageTemplate(
  tenantId: string,
  id: string,
): Promise<PackageTemplate | null> {
  const [template] = await db
    .select()
    .from(packageTemplates)
    .where(
      and(
        eq(packageTemplates.id, id),
        eq(packageTemplates.tenantId, tenantId),
        isNull(packageTemplates.deletedAt),
      ),
    )
    .limit(1)

  if (!template) return null

  const lines = await db
    .select({
      id: packageTemplateLines.id,
      templateId: packageTemplateLines.templateId,
      procedureTypeId: packageTemplateLines.procedureTypeId,
      procedureTypeName: procedureTypes.name,
      sessionsCount: packageTemplateLines.sessionsCount,
      sortOrder: packageTemplateLines.sortOrder,
    })
    .from(packageTemplateLines)
    .innerJoin(procedureTypes, eq(procedureTypes.id, packageTemplateLines.procedureTypeId))
    .where(eq(packageTemplateLines.templateId, id))
    .orderBy(asc(packageTemplateLines.sortOrder))

  return { ...template, lines }
}

export async function createPackageTemplate(
  tenantId: string,
  data: {
    name: string
    description?: string | null
    defaultPrice?: number | null
    validityMonths?: number | null
    lines: Array<{ procedureTypeId: string; sessionsCount: number; sortOrder?: number }>
  },
): Promise<PackageTemplate> {
  return db.transaction(async (tx) => {
    const [template] = await tx
      .insert(packageTemplates)
      .values({
        tenantId,
        name: data.name,
        description: data.description ?? null,
        defaultPrice: data.defaultPrice != null ? data.defaultPrice.toFixed(2) : null,
        validityMonths: data.validityMonths ?? null,
      })
      .returning()

    if (data.lines.length > 0) {
      await tx.insert(packageTemplateLines).values(
        data.lines.map((line, idx) => ({
          templateId: template.id,
          procedureTypeId: line.procedureTypeId,
          sessionsCount: line.sessionsCount,
          sortOrder: line.sortOrder ?? idx,
        })),
      )
    }

    const lines = await tx
      .select({
        id: packageTemplateLines.id,
        templateId: packageTemplateLines.templateId,
        procedureTypeId: packageTemplateLines.procedureTypeId,
        procedureTypeName: procedureTypes.name,
        sessionsCount: packageTemplateLines.sessionsCount,
        sortOrder: packageTemplateLines.sortOrder,
      })
      .from(packageTemplateLines)
      .innerJoin(procedureTypes, eq(procedureTypes.id, packageTemplateLines.procedureTypeId))
      .where(eq(packageTemplateLines.templateId, template.id))
      .orderBy(asc(packageTemplateLines.sortOrder))

    return { ...template, lines }
  })
}

export async function updatePackageTemplate(
  tenantId: string,
  id: string,
  data: {
    name?: string
    description?: string | null
    defaultPrice?: number | null
    validityMonths?: number | null
    isActive?: boolean
    lines?: Array<{ procedureTypeId: string; sessionsCount: number; sortOrder?: number }>
  },
): Promise<PackageTemplate | null> {
  return db.transaction(async (tx) => {
    const updateData: Record<string, unknown> = { updatedAt: new Date() }
    if (data.name !== undefined) updateData.name = data.name
    if (data.description !== undefined) updateData.description = data.description ?? null
    if (data.defaultPrice !== undefined) {
      updateData.defaultPrice = data.defaultPrice != null ? data.defaultPrice.toFixed(2) : null
    }
    if (data.validityMonths !== undefined) updateData.validityMonths = data.validityMonths ?? null
    if (data.isActive !== undefined) updateData.isActive = data.isActive

    const [template] = await tx
      .update(packageTemplates)
      .set(updateData)
      .where(
        and(
          eq(packageTemplates.id, id),
          eq(packageTemplates.tenantId, tenantId),
          isNull(packageTemplates.deletedAt),
        ),
      )
      .returning()

    if (!template) return null

    if (data.lines !== undefined) {
      await tx.delete(packageTemplateLines).where(eq(packageTemplateLines.templateId, id))
      if (data.lines.length > 0) {
        await tx.insert(packageTemplateLines).values(
          data.lines.map((line, idx) => ({
            templateId: id,
            procedureTypeId: line.procedureTypeId,
            sessionsCount: line.sessionsCount,
            sortOrder: line.sortOrder ?? idx,
          })),
        )
      }
    }

    const lines = await tx
      .select({
        id: packageTemplateLines.id,
        templateId: packageTemplateLines.templateId,
        procedureTypeId: packageTemplateLines.procedureTypeId,
        procedureTypeName: procedureTypes.name,
        sessionsCount: packageTemplateLines.sessionsCount,
        sortOrder: packageTemplateLines.sortOrder,
      })
      .from(packageTemplateLines)
      .innerJoin(procedureTypes, eq(procedureTypes.id, packageTemplateLines.procedureTypeId))
      .where(eq(packageTemplateLines.templateId, id))
      .orderBy(asc(packageTemplateLines.sortOrder))

    return { ...template, lines }
  })
}

export async function deletePackageTemplate(
  tenantId: string,
  id: string,
): Promise<boolean> {
  const [template] = await db
    .update(packageTemplates)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(packageTemplates.id, id),
        eq(packageTemplates.tenantId, tenantId),
        isNull(packageTemplates.deletedAt),
      ),
    )
    .returning()

  return !!template
}

// ─── PATIENT PACKAGES ───────────────────────────────────────────────

/**
 * Fetch a patient's packages plus per-line consumption counts in two batched
 * queries (avoids N+1). Lazily writes back `status = 'expired'` for any active
 * package whose `expires_at` is past today (BR calendar day).
 *
 * "consumed" = non-cancelled procedure records (drafts + planned + approved +
 * executed); "executed" = only records actually completed. The session-start
 * race-safety helper uses `consumed`, so the card must show the same notion.
 */
export async function getPatientPackagesWithConsumption(
  tenantId: string,
  patientId: string,
): Promise<PatientPackageWithConsumption[]> {
  const today = brToday()

  // 1. Lazy expire: flip any active packages whose expiresAt is past today.
  await db
    .update(patientPackages)
    .set({ status: 'expired', updatedAt: new Date() })
    .where(
      and(
        eq(patientPackages.tenantId, tenantId),
        eq(patientPackages.patientId, patientId),
        eq(patientPackages.status, 'active'),
        sql`${patientPackages.expiresAt} IS NOT NULL AND ${patientPackages.expiresAt} < ${today}::date`,
      ),
    )

  // 2. Fetch packages
  const packages = await db
    .select()
    .from(patientPackages)
    .where(
      and(
        eq(patientPackages.tenantId, tenantId),
        eq(patientPackages.patientId, patientId),
      ),
    )
    .orderBy(desc(patientPackages.createdAt))

  if (packages.length === 0) return []

  const packageIds = packages.map((p) => p.id)

  // 3. Fetch lines for all packages
  const lines = await db
    .select()
    .from(patientPackageLines)
    .where(inArray(patientPackageLines.patientPackageId, packageIds))
    .orderBy(asc(patientPackageLines.sortOrder))

  if (lines.length === 0) {
    return packages.map((p) => ({ ...p, lines: [] }))
  }

  const lineIds = lines.map((l) => l.id)

  // 4. Aggregate counts per line in a single query: consumed (non-cancelled)
  //    and executed.
  const counts = await db
    .select({
      lineId: procedureRecords.patientPackageLineId,
      consumedCount: sql<number>`count(*) FILTER (WHERE ${procedureRecords.status} != 'cancelled')::int`,
      executedCount: sql<number>`count(*) FILTER (WHERE ${procedureRecords.status} = 'executed')::int`,
    })
    .from(procedureRecords)
    .where(
      and(
        eq(procedureRecords.tenantId, tenantId),
        inArray(procedureRecords.patientPackageLineId, lineIds),
        isNull(procedureRecords.deletedAt),
      ),
    )
    .groupBy(procedureRecords.patientPackageLineId)

  const countsByLine = new Map<string, { consumedCount: number; executedCount: number }>()
  for (const c of counts) {
    if (c.lineId) {
      countsByLine.set(c.lineId, {
        consumedCount: Number(c.consumedCount ?? 0),
        executedCount: Number(c.executedCount ?? 0),
      })
    }
  }

  const linesByPackage = new Map<string, PatientPackageLineWithConsumption[]>()
  for (const line of lines) {
    const counts = countsByLine.get(line.id) ?? { consumedCount: 0, executedCount: 0 }
    const arr = linesByPackage.get(line.patientPackageId) ?? []
    arr.push({
      id: line.id,
      patientPackageId: line.patientPackageId,
      procedureTypeId: line.procedureTypeId,
      procedureTypeName: line.procedureTypeName,
      sessionsTotal: line.sessionsTotal,
      sortOrder: line.sortOrder,
      consumedCount: counts.consumedCount,
      executedCount: counts.executedCount,
    })
    linesByPackage.set(line.patientPackageId, arr)
  }

  return packages.map((p) => {
    // Apply lazy-expire result to in-memory copy.
    const isExpiredNow =
      p.status === 'active' && p.expiresAt != null && p.expiresAt < today
    return {
      ...p,
      status: isExpiredNow ? 'expired' : p.status,
      lines: linesByPackage.get(p.id) ?? [],
    }
  })
}

export async function getPatientPackage(
  tenantId: string,
  id: string,
): Promise<PatientPackageWithConsumption | null> {
  const [pkg] = await db
    .select()
    .from(patientPackages)
    .where(
      and(
        eq(patientPackages.id, id),
        eq(patientPackages.tenantId, tenantId),
      ),
    )
    .limit(1)

  if (!pkg) return null

  const results = await getPatientPackagesWithConsumption(tenantId, pkg.patientId)
  return results.find((p) => p.id === id) ?? null
}
