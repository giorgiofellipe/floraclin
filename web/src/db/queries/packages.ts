import { db } from '@/db/client'
import {
  packageTemplates,
  packageTemplateLines,
  patientPackages,
  procedureRecords,
  procedureSessions,
  procedureTypes,
} from '@/db/schema'
import { and, eq, isNull, sql, inArray, asc, desc } from 'drizzle-orm'
import { brToday } from '@/lib/dates'
import { BusinessError } from '@/lib/errors'
import type { CloseReason } from '@/validations/encerrar-pacote'

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

export interface PatientPackageRecordSessionSummary {
  sessionOrdinal: number
  performedAt: string
  executedByName: string
}

export interface PatientPackageRecordWithConsumption {
  procedureRecordId: string
  procedureTypeId: string
  procedureTypeName: string
  sessionsTotal: number
  sessionsExecuted: number
  sessions: PatientPackageRecordSessionSummary[]
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
  closedAt: Date | null
  closedReason: string | null
  closeNote: string | null
  financialEntryId: string
  soldBy: string
  createdAt: Date
  updatedAt: Date
  records: PatientPackageRecordWithConsumption[]
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

/**
 * Verify that every procedure_type id in the supplied list belongs to the
 * given tenant (and is not soft-deleted). Throws when any id is missing.
 *
 * Used by createPackageTemplate / updatePackageTemplate to refuse
 * cross-tenant FKs that bypass the per-table tenant scope on writes.
 */
async function assertProcedureTypesBelongToTenant(
  tenantId: string,
  procedureTypeIds: string[],
): Promise<void> {
  const unique = Array.from(new Set(procedureTypeIds))
  if (unique.length === 0) return
  const verified = await db
    .select({ id: procedureTypes.id })
    .from(procedureTypes)
    .where(
      and(
        inArray(procedureTypes.id, unique),
        eq(procedureTypes.tenantId, tenantId),
        isNull(procedureTypes.deletedAt),
      ),
    )
  if (verified.length !== unique.length) {
    throw new Error(
      'Procedimento inválido ou pertence a outro estabelecimento',
    )
  }
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
  // Cross-tenant FK validation up-front so a single bad line doesn't leave
  // a half-written template behind if the unique constraint is missed.
  await assertProcedureTypesBelongToTenant(
    tenantId,
    data.lines.map((l) => l.procedureTypeId),
  )

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
  // Cross-tenant FK validation before opening the transaction, same as create.
  if (data.lines !== undefined) {
    await assertProcedureTypesBelongToTenant(
      tenantId,
      data.lines.map((l) => l.procedureTypeId),
    )
  }

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
 * Fetch a patient's packages plus per-record consumption counts in two batched
 * queries (avoids N+1). Lazily writes back `status = 'expired'` for any active
 * package whose `expires_at` is past today (BR calendar day).
 *
 * Consumption is now derived from `procedure_sessions`: each procedure record
 * inside a package has `sessionsTotal` declared up-front, and `sessionsExecuted`
 * is the live count of session rows belonging to it. Drafts/planned/approved
 * records contribute zero sessions until at least one is actually executed.
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

  // 3. Fetch procedure records for all packages, with session-count subquery.
  const records = await db
    .select({
      id: procedureRecords.id,
      patientPackageId: procedureRecords.patientPackageId,
      procedureTypeId: procedureRecords.procedureTypeId,
      procedureTypeName: procedureTypes.name,
      sessionsTotal: procedureRecords.sessionsTotal,
      sessionsExecuted: sql<number>`(
        SELECT COUNT(*)::int FROM floraclin.procedure_sessions ps
        WHERE ps.procedure_record_id = ${procedureRecords.id}
      )`,
      // Per-session summary used by the shared <SessionsTimeline>: ordinal,
      // date, and executor name. `[]` when none executed yet. JSON-encoded
      // server-side so we don't fan out N+1 queries from the client.
      sessions: sql<PatientPackageRecordSessionSummary[]>`(
        SELECT COALESCE(json_agg(
          json_build_object(
            'sessionOrdinal', ps.session_ordinal,
            'performedAt', ps.performed_at,
            'executedByName', u.full_name
          ) ORDER BY ps.session_ordinal
        ), '[]'::json)
        FROM floraclin.procedure_sessions ps
        INNER JOIN floraclin.users u ON u.id = ps.executed_by
        WHERE ps.procedure_record_id = ${procedureRecords.id}
      )`,
      createdAt: procedureRecords.createdAt,
    })
    .from(procedureRecords)
    .innerJoin(procedureTypes, eq(procedureRecords.procedureTypeId, procedureTypes.id))
    .where(
      and(
        eq(procedureRecords.tenantId, tenantId),
        inArray(procedureRecords.patientPackageId, packageIds),
        isNull(procedureRecords.deletedAt),
      ),
    )
    .orderBy(asc(procedureRecords.createdAt))

  const recordsByPackage = new Map<string, PatientPackageRecordWithConsumption[]>()
  for (const r of records) {
    if (!r.patientPackageId) continue
    const arr = recordsByPackage.get(r.patientPackageId) ?? []
    arr.push({
      procedureRecordId: r.id,
      procedureTypeId: r.procedureTypeId,
      procedureTypeName: r.procedureTypeName,
      sessionsTotal: r.sessionsTotal,
      sessionsExecuted: Number(r.sessionsExecuted ?? 0),
      sessions: (r.sessions ?? []) as PatientPackageRecordSessionSummary[],
    })
    recordsByPackage.set(r.patientPackageId, arr)
  }

  return packages.map((p) => {
    // Apply lazy-expire result to in-memory copy.
    const isExpiredNow =
      p.status === 'active' && p.expiresAt != null && p.expiresAt < today
    return {
      ...p,
      status: isExpiredNow ? 'expired' : p.status,
      records: recordsByPackage.get(p.id) ?? [],
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

  const records = await db
    .select({
      id: procedureRecords.id,
      procedureTypeId: procedureRecords.procedureTypeId,
      procedureTypeName: procedureTypes.name,
      sessionsTotal: procedureRecords.sessionsTotal,
      sessionsExecuted: sql<number>`(
        SELECT COUNT(*)::int FROM floraclin.procedure_sessions ps
        WHERE ps.procedure_record_id = ${procedureRecords.id}
      )`,
      sessions: sql<PatientPackageRecordSessionSummary[]>`(
        SELECT COALESCE(json_agg(
          json_build_object(
            'sessionOrdinal', ps.session_ordinal,
            'performedAt', ps.performed_at,
            'executedByName', u.full_name
          ) ORDER BY ps.session_ordinal
        ), '[]'::json)
        FROM floraclin.procedure_sessions ps
        INNER JOIN floraclin.users u ON u.id = ps.executed_by
        WHERE ps.procedure_record_id = ${procedureRecords.id}
      )`,
    })
    .from(procedureRecords)
    .innerJoin(procedureTypes, eq(procedureRecords.procedureTypeId, procedureTypes.id))
    .where(
      and(
        eq(procedureRecords.tenantId, tenantId),
        eq(procedureRecords.patientPackageId, id),
        isNull(procedureRecords.deletedAt),
      ),
    )
    .orderBy(asc(procedureRecords.createdAt))

  return {
    ...pkg,
    records: records.map((r) => ({
      procedureRecordId: r.id,
      procedureTypeId: r.procedureTypeId,
      procedureTypeName: r.procedureTypeName,
      sessionsTotal: r.sessionsTotal,
      sessionsExecuted: Number(r.sessionsExecuted ?? 0),
      sessions: (r.sessions ?? []) as PatientPackageRecordSessionSummary[],
    })),
  }
}

/**
 * Close a patient package: set status='completed', record the close metadata,
 * and persist the operator-provided note only when reason is 'other'.
 *
 * Locks the package row with `FOR UPDATE` before mutating to prevent two
 * races:
 *
 *   1. Concurrent execution (e.g. `executeSession` on a procedure record):
 *      `executeSession` locks `procedure_records` then `patient_packages`,
 *      so taking the same `patient_packages` lock here serializes both
 *      flows on the package row.
 *   2. Terminal-state laundering: re-stamping `closedAt`/`closedReason` on
 *      a row that's already `cancelled`/`completed` muddies the audit
 *      trail. The status check inside the lock refuses anything that is
 *      not currently `active`.
 *
 * Throws `BusinessError('not_found')` when the row is missing or belongs
 * to another tenant, and `BusinessError('package_not_active')` when the
 * row exists but isn't in the `active` state.
 *
 * Accepts an optional `tx` so it can be composed inside the action helper's
 * transaction alongside an audit log write. The lock is only meaningful
 * inside a transaction, so callers that hand a non-tx `db` get the same
 * checks but no row-level serialization guarantee.
 */
export async function closePackageQuery(
  tenantId: string,
  packageId: string,
  args: { closedReason: CloseReason; closeNote: string | null },
  tx: typeof db = db,
): Promise<{ id: string; closedAt: Date | null; closedReason: string | null }> {
  const [locked] = await tx
    .select({
      id: patientPackages.id,
      status: patientPackages.status,
    })
    .from(patientPackages)
    .where(
      and(
        eq(patientPackages.tenantId, tenantId),
        eq(patientPackages.id, packageId),
      ),
    )
    .for('update')
    .limit(1)

  if (!locked) {
    throw new BusinessError('not_found', 'Pacote não encontrado')
  }
  if (locked.status !== 'active') {
    throw new BusinessError(
      'package_not_active',
      `Pacote já está em estado ${locked.status}`,
    )
  }

  const [updated] = await tx
    .update(patientPackages)
    .set({
      status: 'completed',
      closedAt: new Date(),
      closedReason: args.closedReason,
      closeNote: args.closedReason === 'other' ? args.closeNote : null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(patientPackages.tenantId, tenantId),
        eq(patientPackages.id, packageId),
      ),
    )
    .returning({
      id: patientPackages.id,
      closedAt: patientPackages.closedAt,
      closedReason: patientPackages.closedReason,
    })

  // Defensive: the FOR UPDATE lock guarantees the row was here a moment
  // ago, but if a sibling transaction managed to delete it between the
  // lock release and the UPDATE (shouldn't happen — same tx), surface a
  // not_found rather than dereference undefined.
  if (!updated) {
    throw new BusinessError('not_found', 'Pacote não encontrado')
  }

  // The UPDATE above always sets both columns; the return type stays nullable
  // to match the schema so the call site doesn't grow a non-null assertion
  // either. Callers that depend on non-null values can assert at the boundary.
  return {
    id: updated.id,
    closedAt: updated.closedAt,
    closedReason: updated.closedReason,
  }
}
