import { and, eq } from 'drizzle-orm'
import { db } from '@/db/client'
import { patientPackages, procedureRecords } from '@/db/schema'
import {
  countSessionsForRecord,
  createSession,
  type CreateSessionInput,
} from '@/db/queries/procedure-sessions'
import { saveProductApplicationsForSession } from '@/db/queries/product-applications'
import { saveFaceDiagramForSession } from '@/db/queries/face-diagrams'
import { assignPhotosToSession } from '@/db/queries/photos'
import { maybeCompletePackage } from '@/lib/packages'
import { createAuditLog } from '@/lib/audit'
import { BusinessError } from '@/lib/errors'
import { withTransaction } from '@/lib/tenant'
import type { ProductApplicationItem } from '@/validations/procedure'
import type { DiagramViewType } from '@/types'

export interface DiagramPayload {
  viewType: DiagramViewType
  points: Array<{
    x: number
    y: number
    productName: string
    activeIngredient?: string
    quantity: number
    quantityUnit: string
    technique?: string
    depth?: string
    notes?: string
  }>
}

/**
 * Input for `executeSession`. Extends the bare `CreateSessionInput` (which
 * defines the row going into `procedure_sessions`) with the side-data the
 * end-of-session form collects in one go: product applications, face
 * diagrams, and photo references.
 *
 * `expectedOrdinal` is intentionally NOT exposed here — the service computes
 * it from the locked record so callers can't drift it out of sync.
 */
export interface ExecuteSessionInput extends Omit<CreateSessionInput, 'expectedOrdinal'> {
  productApplications?: ProductApplicationItem[]
  diagrams?: DiagramPayload[]
  photoAssetIds?: string[]
}

export interface ExecuteSessionResult {
  sessionId: string
  recordStatus: string
  packageCompleted: boolean
}

/**
 * Materialize one procedure session and advance the parent record / package
 * statuses atomically.
 *
 * The whole flow runs inside a transaction so that a failure anywhere
 * (createSession ordinal race, side-data write, status flip, audit log)
 * rolls the session row back too. Callers may pass `outerTx` when they're
 * already inside a transaction; otherwise we start our own.
 *
 * Concurrency strategy (Patch P2):
 *  1. `FOR UPDATE` lock on `procedure_records` — serializes any two
 *     `executeSession` calls targeting the same record.
 *  2. `FOR UPDATE` lock on the linked `patient_packages` row (if any) —
 *     prevents racing with `closePackage` / `cancelPackage` /
 *     `maybeCompletePackage`.
 *  3. `createSession` is then called with `expectedOrdinal = sessionsDone + 1`.
 *     It re-asserts MAX+1 under the same transaction; if another writer
 *     somehow slipped past our locks, the unique index on
 *     `(procedure_record_id, session_ordinal)` is the safety net.
 *
 * Business gates (all surfaced as `BusinessError` so the API can return 409):
 *  - `not_found` — record missing or soft-deleted.
 *  - `record_already_terminal` — record is `completed` or `cancelled`.
 *  - `package_missing` — record links to a package that no longer exists.
 *  - `package_terminal` — linked package is closed/cancelled/completed.
 *  - `all_sessions_executed` — record already has `sessionsTotal` sessions.
 */
export async function executeSession(
  input: ExecuteSessionInput,
  outerTx?: typeof db,
): Promise<ExecuteSessionResult> {
  const run = async (tx: typeof db): Promise<ExecuteSessionResult> => {
    // 1. Lock the parent procedure_records row, scoped by tenant.
    const [record] = await tx
      .select({
        id: procedureRecords.id,
        tenantId: procedureRecords.tenantId,
        status: procedureRecords.status,
        sessionsTotal: procedureRecords.sessionsTotal,
        patientPackageId: procedureRecords.patientPackageId,
        deletedAt: procedureRecords.deletedAt,
      })
      .from(procedureRecords)
      .where(
        and(
          eq(procedureRecords.id, input.procedureRecordId),
          eq(procedureRecords.tenantId, input.tenantId),
        ),
      )
      .for('update')
      .limit(1)

    if (!record || record.deletedAt) {
      throw new BusinessError('not_found')
    }
    if (record.status === 'completed' || record.status === 'cancelled') {
      throw new BusinessError('record_already_terminal')
    }

    // 2. Lock the linked patient_packages row (if any) and refuse terminal state.
    if (record.patientPackageId) {
      const [pkg] = await tx
        .select({
          status: patientPackages.status,
          closedAt: patientPackages.closedAt,
        })
        .from(patientPackages)
        .where(eq(patientPackages.id, record.patientPackageId))
        .for('update')
        .limit(1)

      if (!pkg) throw new BusinessError('package_missing')
      if (
        pkg.status === 'cancelled' ||
        pkg.status === 'completed' ||
        pkg.closedAt
      ) {
        throw new BusinessError('package_terminal')
      }
    }

    // 3. Count existing sessions; refuse if the record is already saturated.
    const sessionsDone = await countSessionsForRecord(
      input.procedureRecordId,
      tx,
    )
    if (sessionsDone >= record.sessionsTotal) {
      throw new BusinessError('all_sessions_executed')
    }

    // 4. Insert the session row at the expected ordinal. createSession
    //    asserts MAX+1 === expectedOrdinal post-lock; if it fails it throws
    //    `Error('concurrent_session_insert')` which we re-wrap.
    let session: Awaited<ReturnType<typeof createSession>>
    try {
      session = await createSession(
        {
          tenantId: input.tenantId,
          procedureRecordId: input.procedureRecordId,
          executedBy: input.executedBy,
          performedAt: input.performedAt,
          technique: input.technique,
          clinicalResponse: input.clinicalResponse,
          adverseEffects: input.adverseEffects,
          notes: input.notes,
          followUpDate: input.followUpDate,
          nextSessionObjectives: input.nextSessionObjectives,
          expectedOrdinal: sessionsDone + 1,
        },
        tx,
      )
    } catch (err) {
      if (err instanceof Error && err.message === 'concurrent_session_insert') {
        throw new BusinessError('concurrent_session_insert')
      }
      throw err
    }

    // 5. Side data writes.
    if (input.productApplications?.length) {
      await saveProductApplicationsForSession(
        input.tenantId,
        input.procedureRecordId,
        session.id,
        input.productApplications,
        tx,
      )
    }
    for (const diagram of input.diagrams ?? []) {
      await saveFaceDiagramForSession(
        input.tenantId,
        input.procedureRecordId,
        session.id,
        diagram.viewType,
        diagram.points,
        tx,
      )
    }
    // Photos were uploaded during form filling with procedureSessionId = null;
    // reassign them to this session now. The query filters by both tenant and
    // procedureRecordId so a forged id can't steal photos from another record.
    if (input.photoAssetIds?.length) {
      await assignPhotosToSession(
        input.tenantId,
        input.procedureRecordId,
        session.id,
        input.photoAssetIds,
        tx,
      )
    }

    // 6. Status transitions on the parent record.
    const sessionsAfter = sessionsDone + 1
    let nextStatus = record.status
    if (sessionsAfter >= record.sessionsTotal) {
      nextStatus = 'completed'
    } else if (record.status === 'approved') {
      nextStatus = 'in_progress'
    }

    if (nextStatus !== record.status) {
      await tx
        .update(procedureRecords)
        .set({
          status: nextStatus,
          performedAt: session.performedAt,
          updatedAt: new Date(),
        })
        .where(eq(procedureRecords.id, input.procedureRecordId))
    }

    // 7. Cascade: if every line on the package is now consumed, flip the
    //    package to completed. No-op when the record isn't on a package.
    let packageCompleted = false
    if (record.patientPackageId) {
      packageCompleted = await maybeCompletePackage(
        input.tenantId,
        record.patientPackageId,
        tx,
      )
    }

    // 8. Audit trail — same transaction so the log can't outlive a rollback.
    await createAuditLog(
      {
        tenantId: input.tenantId,
        userId: input.executedBy,
        action: 'create',
        entityType: 'procedure_session',
        entityId: session.id,
        changes: {
          sessionOrdinal: { old: null, new: session.sessionOrdinal },
        },
      },
      tx,
    )

    return {
      sessionId: session.id,
      recordStatus: nextStatus,
      packageCompleted,
    }
  }

  return outerTx ? run(outerTx) : withTransaction(run)
}
