import { db } from '@/db/client'
import {
  packageTemplates,
  patientPackages,
  patientPackageLines,
  procedureRecords,
  procedureTypes,
} from '@/db/schema'
import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import { addMonths } from 'date-fns'
import { brToday, parseBrDate, toLocalYmd } from '@/lib/dates'
import { withTransaction } from '@/lib/tenant'
import { createFinancialEntry } from '@/db/queries/financial'
import type { SellPackageInput } from '@/validations/package'

/**
 * Compute the expiry date for a package purchased today.
 *
 * Returns null when no validity is provided (open-ended package).
 *
 * Date math is BR-anchored (noon in BR) before adding months so DST/UTC
 * offsets can't shift the calendar day at the edges. Extracted as a pure
 * function so it's trivially testable without a DB.
 */
export function computePackageExpiresAt(
  validityMonths: number | null | undefined,
  today: string = brToday(),
): string | null {
  if (validityMonths == null) return null
  return toLocalYmd(addMonths(parseBrDate(today, '12:00:00'), validityMonths))
}

/**
 * Sell a package: in one transaction create the financial entry (which
 * generates installments via the shared helper), the package row, and its
 * lines. Returns the new IDs.
 *
 * Reuses `createFinancialEntry` from db/queries/financial.ts so installments
 * follow the same generation rules as any other payable.
 *
 * NOTE: `paymentMethod` from the input is currently informational — the
 * financial helper creates installments without committing them paid, and
 * the receptionist marks them paid via the normal extrato flow. This keeps
 * the package sale aligned with how procedure-approved entries already work.
 */
export async function sellPackage(args: {
  tenantId: string
  soldBy: string
  input: SellPackageInput
}): Promise<{ packageId: string; financialEntryId: string }> {
  // 1. Cross-tenant FK validation — refuse to touch IDs that belong to other
  //    tenants. Done up-front (outside the transaction) so we fail fast and
  //    don't leak partial financial-entry side-effects on bad input.
  const requestedTypeIds = Array.from(
    new Set(args.input.lines.map((l) => l.procedureTypeId)),
  )
  if (requestedTypeIds.length === 0) {
    throw new Error('Pacote precisa de pelo menos uma linha')
  }

  const verifiedTypes = await db
    .select({ id: procedureTypes.id, name: procedureTypes.name })
    .from(procedureTypes)
    .where(
      and(
        inArray(procedureTypes.id, requestedTypeIds),
        eq(procedureTypes.tenantId, args.tenantId),
        isNull(procedureTypes.deletedAt),
      ),
    )

  if (verifiedTypes.length !== requestedTypeIds.length) {
    throw new Error(
      'Procedimento inválido ou pertence a outro estabelecimento',
    )
  }

  const typeNameById = new Map<string, string>(
    verifiedTypes.map((t) => [t.id, t.name]),
  )

  if (args.input.templateId != null) {
    const [template] = await db
      .select({ id: packageTemplates.id })
      .from(packageTemplates)
      .where(
        and(
          eq(packageTemplates.id, args.input.templateId),
          eq(packageTemplates.tenantId, args.tenantId),
          isNull(packageTemplates.deletedAt),
        ),
      )
      .limit(1)
    if (!template) {
      throw new Error(
        'Modelo de pacote inválido ou pertence a outro estabelecimento',
      )
    }
  }

  return withTransaction(async (tx) => {
    // 2. Create financial entry + installments via the existing helper.
    const entry = await createFinancialEntry(
      args.tenantId,
      args.soldBy,
      {
        patientId: args.input.patientId,
        description: args.input.name,
        totalAmount: args.input.totalAmount,
        installmentCount: args.input.installmentCount,
      },
      tx,
    )

    // 3. Compute expires_at (BR-anchored, no bare `new Date(ymd)`).
    const expiresAt = computePackageExpiresAt(args.input.validityMonths)

    // 4. Create patient_packages row.
    const [pkg] = await tx
      .insert(patientPackages)
      .values({
        tenantId: args.tenantId,
        patientId: args.input.patientId,
        templateId: args.input.templateId,
        name: args.input.name,
        totalAmount: args.input.totalAmount.toFixed(2),
        purchasedAt: brToday(),
        expiresAt,
        status: 'active',
        financialEntryId: entry.id,
        soldBy: args.soldBy,
      })
      .returning()

    // 5. Create patient_package_lines (one row per line, preserving order).
    //    procedureTypeName is derived server-side from the verified lookup —
    //    we never trust the client-supplied name on this hot path.
    for (let i = 0; i < args.input.lines.length; i++) {
      const line = args.input.lines[i]
      const verifiedName = typeNameById.get(line.procedureTypeId)
      if (!verifiedName) {
        // Defensive: should be unreachable because of the up-front check.
        throw new Error(
          'Procedimento inválido ou pertence a outro estabelecimento',
        )
      }
      await tx.insert(patientPackageLines).values({
        patientPackageId: pkg.id,
        procedureTypeId: line.procedureTypeId,
        procedureTypeName: verifiedName,
        sessionsTotal: line.sessionsTotal,
        sortOrder: i,
      })
    }

    return { packageId: pkg.id, financialEntryId: entry.id }
  })
}

/**
 * Start the next session for a package line. Race-safe:
 *
 *  1. Locks the parent `patient_packages` row with `SELECT … FOR UPDATE`
 *     FIRST so it can interlock with `cancelPackage` (which also locks the
 *     package row first). Keeping the lock order consistent across both
 *     functions avoids ABBA deadlocks.
 *  2. Then locks the `patient_package_lines` row so concurrent starts on
 *     the same line can't both see free capacity.
 *  3. Counts every non-cancelled procedure record on the line — drafts,
 *     planned, approved, executed — as consumed. Starting a session
 *     "reserves" the slot; the slot only frees up if the procedure is later
 *     cancelled.
 *
 * Both lock queries scope by `tenant_id` to prevent cross-tenant lookups
 * via a forged path param. A 0-row lock result is treated as "not found".
 *
 * The resulting `draft` procedure record enters the normal procedure
 * lifecycle (planning → approval → execution).
 */
export async function startPackageSession(args: {
  tenantId: string
  practitionerId: string
  patientPackageId: string
  patientPackageLineId: string
  allowExpiredOverride?: boolean
}): Promise<{ procedureRecordId: string }> {
  return withTransaction(async (tx) => {
    // 1. Lock the parent package row first (consistent order with cancelPackage).
    //    Scoped by tenant — a row returned here is guaranteed to be ours.
    const pkgLockResult = await tx.execute(sql`
      SELECT id, tenant_id, patient_id, status, expires_at
      FROM floraclin.patient_packages
      WHERE id = ${args.patientPackageId}
        AND tenant_id = ${args.tenantId}
      FOR UPDATE
    `)
    const pkgRows = (Array.isArray(pkgLockResult)
      ? pkgLockResult
      : (pkgLockResult as { rows?: Record<string, unknown>[] }).rows ?? pkgLockResult) as Record<string, unknown>[]
    const pkgRow = pkgRows[0]
    if (!pkgRow) throw new Error('Pacote não encontrado')

    const pkg = {
      id: String(pkgRow.id),
      patientId: String(pkgRow.patient_id),
      status: String(pkgRow.status),
      expiresAt: pkgRow.expires_at == null ? null : String(pkgRow.expires_at),
    }

    if (pkg.status === 'cancelled') throw new Error('Pacote cancelado')
    if (pkg.status === 'completed') throw new Error('Pacote já concluído')
    if (pkg.status === 'expired' && !args.allowExpiredOverride) {
      throw new Error('Pacote expirado')
    }
    if (pkg.expiresAt && pkg.expiresAt < brToday() && !args.allowExpiredOverride) {
      throw new Error('Pacote expirado')
    }

    // 2. Now lock the line row. Scope by tenant via the parent package join
    //    so a forged line_id from another tenant can never acquire the lock.
    const lockResult = await tx.execute(sql`
      SELECT ppl.id, ppl.patient_package_id, ppl.procedure_type_id, ppl.procedure_type_name, ppl.sessions_total
      FROM floraclin.patient_package_lines ppl
      INNER JOIN floraclin.patient_packages pp ON pp.id = ppl.patient_package_id
      WHERE ppl.id = ${args.patientPackageLineId}
        AND pp.tenant_id = ${args.tenantId}
      FOR UPDATE OF ppl
    `)
    const rows = (Array.isArray(lockResult)
      ? lockResult
      : (lockResult as { rows?: Record<string, unknown>[] }).rows ?? lockResult) as Record<string, unknown>[]
    const lineRow = rows[0]
    if (!lineRow) throw new Error('Linha do pacote não encontrada')

    const line = {
      id: String(lineRow.id),
      patientPackageId: String(lineRow.patient_package_id),
      procedureTypeId: String(lineRow.procedure_type_id),
      sessionsTotal: Number(lineRow.sessions_total),
    }

    if (line.patientPackageId !== args.patientPackageId) {
      throw new Error('Linha não pertence ao pacote informado')
    }

    // 3. Count consumed slots: every non-cancelled record reserves a slot.
    const [{ count }] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(procedureRecords)
      .where(
        and(
          eq(procedureRecords.patientPackageLineId, args.patientPackageLineId),
          sql`${procedureRecords.status} != 'cancelled'`,
        ),
      )

    if (Number(count) >= line.sessionsTotal) {
      throw new Error('Sessões do pacote esgotadas (incluindo em andamento)')
    }

    // 4. Create the draft procedure record while still inside the lock.
    const [record] = await tx
      .insert(procedureRecords)
      .values({
        tenantId: args.tenantId,
        patientId: pkg.patientId,
        practitionerId: args.practitionerId,
        procedureTypeId: line.procedureTypeId,
        patientPackageId: pkg.id,
        patientPackageLineId: args.patientPackageLineId,
        status: 'draft',
      })
      .returning()

    return { procedureRecordId: record.id }
  })
}

/**
 * Cancel a patient package. Acquires `FOR UPDATE` on the package row so the
 * cancel can't race with a session-start. `startPackageSession` locks the
 * same package row first (consistent lock order) and then the line row —
 * cancel only needs the package row, so we never invert that order.
 *
 * Lock scopes by `tenant_id` to refuse cross-tenant lookups. A 0-row lock
 * result is reported as "Pacote não encontrado" (matches what the API layer
 * would have returned anyway).
 *
 * Only `active` or `expired` packages can be cancelled; cancelling a
 * completed or already-cancelled package is a no-op (returns false).
 */
export async function cancelPackage(args: {
  tenantId: string
  patientPackageId: string
  reason: string
}): Promise<boolean> {
  return withTransaction(async (tx) => {
    const lockResult = await tx.execute(sql`
      SELECT id, status
      FROM floraclin.patient_packages
      WHERE id = ${args.patientPackageId}
        AND tenant_id = ${args.tenantId}
      FOR UPDATE
    `)
    const rows = (Array.isArray(lockResult)
      ? lockResult
      : (lockResult as { rows?: Record<string, unknown>[] }).rows ?? lockResult) as Record<string, unknown>[]
    const row = rows[0]
    if (!row) throw new Error('Pacote não encontrado')

    const status = String(row.status)
    if (status !== 'active' && status !== 'expired') return false

    await tx
      .update(patientPackages)
      .set({
        status: 'cancelled',
        cancelledAt: new Date(),
        cancelReason: args.reason,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(patientPackages.id, args.patientPackageId),
          eq(patientPackages.tenantId, args.tenantId),
        ),
      )

    return true
  })
}

/**
 * Pure helper for testing maybeCompletePackage's decision logic:
 * given a list of (sessionsTotal, executedCount) pairs, returns whether
 * every line is fully consumed. Extracted so we don't need a DB to test.
 */
export function shouldCompletePackage(
  lines: ReadonlyArray<{ sessionsTotal: number; executedCount: number }>,
): boolean {
  if (lines.length === 0) return false
  return lines.every((l) => l.executedCount >= l.sessionsTotal)
}

/**
 * Convenience wrapper for the procedure-execute hook: looks up the package
 * ID from a procedure record, then defers to `maybeCompletePackage`. No-op
 * when the procedure isn't tied to a package.
 *
 * Lets the execute route stay a one-line wiring change without needing to
 * project `patientPackageId` through the procedure read query.
 */
export async function maybeCompletePackageForProcedure(
  tenantId: string,
  procedureRecordId: string,
): Promise<void> {
  const [rec] = await db
    .select({ patientPackageId: procedureRecords.patientPackageId })
    .from(procedureRecords)
    .where(
      and(
        eq(procedureRecords.id, procedureRecordId),
        eq(procedureRecords.tenantId, tenantId),
      ),
    )
    .limit(1)
  if (!rec?.patientPackageId) return
  await maybeCompletePackage(tenantId, rec.patientPackageId)
}

/**
 * Called after a procedure record transitions to `executed`. Sums executed
 * counts per line for the package; if every line is fully consumed, flips
 * the package status to `completed`.
 *
 * Idempotent: if the package is already non-active (cancelled, expired,
 * completed), it's a no-op.
 */
export async function maybeCompletePackage(
  tenantId: string,
  patientPackageId: string,
): Promise<void> {
  const [pkg] = await db
    .select()
    .from(patientPackages)
    .where(
      and(
        eq(patientPackages.id, patientPackageId),
        eq(patientPackages.tenantId, tenantId),
      ),
    )
    .limit(1)
  if (!pkg || pkg.status !== 'active') return

  const lines = await db
    .select()
    .from(patientPackageLines)
    .where(eq(patientPackageLines.patientPackageId, patientPackageId))
  if (lines.length === 0) return

  // Single batched count: executed per line.
  const counts = await db
    .select({
      lineId: procedureRecords.patientPackageLineId,
      executedCount: sql<number>`count(*)::int`,
    })
    .from(procedureRecords)
    .where(
      and(
        eq(procedureRecords.tenantId, tenantId),
        eq(procedureRecords.patientPackageId, patientPackageId),
        eq(procedureRecords.status, 'executed'),
      ),
    )
    .groupBy(procedureRecords.patientPackageLineId)

  const executedByLine = new Map<string, number>()
  for (const c of counts) {
    if (c.lineId) executedByLine.set(c.lineId, Number(c.executedCount ?? 0))
  }

  const summary = lines.map((l) => ({
    sessionsTotal: l.sessionsTotal,
    executedCount: executedByLine.get(l.id) ?? 0,
  }))

  if (!shouldCompletePackage(summary)) return

  await db
    .update(patientPackages)
    .set({ status: 'completed', updatedAt: new Date() })
    .where(
      and(
        eq(patientPackages.id, patientPackageId),
        eq(patientPackages.tenantId, tenantId),
        eq(patientPackages.status, 'active'),
      ),
    )
}
