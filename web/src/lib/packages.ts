import { db } from '@/db/client'
import {
  patientPackages,
  procedureRecords,
  procedureSessions,
} from '@/db/schema'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { addMonths } from 'date-fns'
import { brToday, parseBrDate, toLocalYmd } from '@/lib/dates'
import { withTransaction } from '@/lib/tenant'
import { createAuditLog } from '@/lib/audit'
import { closePackageQuery } from '@/db/queries/packages'
import type { CloseReason } from '@/validations/encerrar-pacote'

/**
 * Compute the expiry date for a package purchased today.
 *
 * Returns null when no validity is provided (open-ended package) — tenants
 * configure validity to `null` to disable expiry entirely.
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
 * Cancel a patient package. Acquires `FOR UPDATE` on the package row so the
 * cancel can't race with other writers. Lock scopes by `tenant_id` to refuse
 * cross-tenant lookups. A 0-row lock result is reported as "Pacote não
 * encontrado" (matches what the API layer would have returned anyway).
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
 * Close (early-end) a patient package. Writes the close metadata via
 * `closePackageQuery` and emits an audit log inside the same transaction so
 * either both succeed or neither does.
 *
 * Distinct from `cancelPackage`: a close records why treatment ended early
 * (patient lost expiry / desistance / other) and flips status to a closed
 * terminal state. The financial side-effects (refund vs. retain installments)
 * are driven by the existing financial flows, not by this helper.
 */
export async function closePackage(
  args: {
    tenantId: string
    userId: string
    packageId: string
    closedReason: CloseReason
    closeNote: string | null
  },
  tx: typeof db = db,
): Promise<void> {
  await closePackageQuery(
    args.tenantId,
    args.packageId,
    {
      closedReason: args.closedReason,
      closeNote: args.closeNote,
    },
    tx,
  )
  await createAuditLog(
    {
      tenantId: args.tenantId,
      userId: args.userId,
      action: 'update',
      entityType: 'patient_package',
      entityId: args.packageId,
      changes: { closedReason: { old: null, new: args.closedReason } },
    },
    tx,
  )
}

/**
 * Pure helper for testing maybeCompletePackage's decision logic: given a list
 * of (sessionsTotal, executedCount) pairs, returns whether every record is
 * fully consumed. Extracted so we don't need a DB to test.
 *
 * Kept after the sessions-driven refactor because the test suite asserts the
 * predicate directly — the in-DB path in `maybeCompletePackage` no longer
 * calls it (counts are short-circuit-checked per record), but the semantics
 * match: every entry must satisfy `executedCount >= sessionsTotal`.
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
  tx: typeof db = db,
): Promise<void> {
  const [record] = await tx
    .select({ patientPackageId: procedureRecords.patientPackageId })
    .from(procedureRecords)
    .where(eq(procedureRecords.id, procedureRecordId))
    .limit(1)
  if (!record?.patientPackageId) return
  await maybeCompletePackage(tenantId, record.patientPackageId, tx)
}

/**
 * Called after a procedure session lands. Counts `procedure_sessions` rows
 * per record on the package; if every record has met its `sessionsTotal`,
 * flips the package status to `completed`.
 *
 * Idempotent: the final UPDATE is filtered to `status = 'active'`, so a
 * second call (or a concurrent caller racing past the check) is a no-op.
 * Early returns when there are no records on the package — a brand-new
 * package with no procedures yet stays `active`.
 */
export async function maybeCompletePackage(
  tenantId: string,
  packageId: string,
  tx: typeof db = db,
): Promise<boolean> {
  const records = await tx
    .select({
      id: procedureRecords.id,
      sessionsTotal: procedureRecords.sessionsTotal,
    })
    .from(procedureRecords)
    .where(
      and(
        eq(procedureRecords.tenantId, tenantId),
        eq(procedureRecords.patientPackageId, packageId),
        isNull(procedureRecords.deletedAt),
      ),
    )
  if (records.length === 0) return false

  for (const r of records) {
    const [{ n }] = await tx
      .select({ n: sql<number>`COUNT(*)::int` })
      .from(procedureSessions)
      .where(eq(procedureSessions.procedureRecordId, r.id))
    if (n < r.sessionsTotal) return false
  }

  await tx
    .update(patientPackages)
    .set({ status: 'completed', updatedAt: new Date() })
    .where(
      and(
        eq(patientPackages.tenantId, tenantId),
        eq(patientPackages.id, packageId),
        eq(patientPackages.status, 'active'),
      ),
    )
  return true
}
