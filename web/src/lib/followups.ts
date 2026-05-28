import { db } from '@/db/client'
import {
  financialEntries,
  installments,
  procedureFollowups,
  procedureRecords,
} from '@/db/schema'
import { and, eq, isNull } from 'drizzle-orm'
import type { FollowupChannel, FollowupOutcome } from '@/validations/followup'

export interface RecordFollowupArgs {
  tenantId: string
  contactedBy: string
  procedureRecordId: string
  channel: FollowupChannel
  outcome: FollowupOutcome
  notes?: string | null
}

export interface RecordFollowupResult {
  followupId: string
  cancelledProcedure: boolean
  previousStatus: string | null
}

// Statuses from which a followup of outcome === 'desistiu' may flip the
// procedure into `cancelled`. Cancelled / executed / draft procedures must
// NOT be transitioned through this path — those flows belong to the dedicated
// `/cancel` route (draft) or are simply not legal (executed/cancelled).
const DESISTIU_ALLOWED_FROM_STATUSES = new Set(['planned', 'approved'])

/**
 * Cancels every linked financial entry (and its installments) for an approved
 * procedure that is being cancelled via the followup path. Mirrors the cleanup
 * done by `web/src/app/api/procedures/[id]/cancel/route.ts` so the two flows
 * stay in sync.
 */
async function cancelLinkedFinancials(
  // The transaction object — drizzle infers the same shape as `db` for query
  // builders, so a minimal typing here keeps callers honest without leaking
  // internal types.
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  tenantId: string,
  procedureRecordId: string,
): Promise<void> {
  const now = new Date()
  const cancelledEntries = await tx
    .update(financialEntries)
    .set({ status: 'cancelled', updatedAt: now })
    .where(
      and(
        eq(financialEntries.procedureRecordId, procedureRecordId),
        eq(financialEntries.tenantId, tenantId),
        isNull(financialEntries.deletedAt),
      ),
    )
    .returning({ id: financialEntries.id })

  for (const entry of cancelledEntries) {
    await tx
      .update(installments)
      .set({ status: 'cancelled', updatedAt: now })
      .where(
        and(
          eq(installments.financialEntryId, entry.id),
          eq(installments.tenantId, tenantId),
        ),
      )
  }
}

/**
 * Records a followup contact attempt on a procedure_records row.
 *
 * Always:
 *  - Inserts a new procedure_followups row.
 *  - Updates procedure_records.last_contacted_at to the contact instant.
 *
 * When outcome === 'desistiu' (patient declined to proceed), also:
 *  - Sets procedure_records.status = 'cancelled'
 *  - Sets procedure_records.cancellation_reason = 'patient_declined'
 *  - Sets procedure_records.cancelled_at = now()
 *  - If previous status was 'approved', cancels all linked financial entries
 *    and their installments (mirrors the /cancel route).
 *
 * Throws:
 *  - 'Procedure not found' if the procedure record does not belong to the
 *    given tenant.
 *  - 'Procedure cannot be cancelled from current status' if outcome is
 *    'desistiu' and the procedure status is not in ('planned', 'approved').
 */
export async function recordFollowup(
  args: RecordFollowupArgs,
): Promise<RecordFollowupResult> {
  return db.transaction(async (tx) => {
    const [proc] = await tx
      .select({
        id: procedureRecords.id,
        tenantId: procedureRecords.tenantId,
        status: procedureRecords.status,
      })
      .from(procedureRecords)
      .where(
        and(
          eq(procedureRecords.id, args.procedureRecordId),
          isNull(procedureRecords.deletedAt),
        ),
      )
      .limit(1)

    if (!proc || proc.tenantId !== args.tenantId) {
      throw new Error('Procedure not found')
    }

    // Guard: only planned/approved procedures may be cancelled via desistiu.
    // Cancelled, executed, or draft procedures must not transition here.
    if (
      args.outcome === 'desistiu' &&
      !DESISTIU_ALLOWED_FROM_STATUSES.has(proc.status)
    ) {
      throw new Error('Procedure cannot be cancelled from current status')
    }

    const now = new Date()

    const [followup] = await tx
      .insert(procedureFollowups)
      .values({
        tenantId: args.tenantId,
        procedureRecordId: args.procedureRecordId,
        contactedBy: args.contactedBy,
        contactedAt: now,
        channel: args.channel,
        outcome: args.outcome,
        notes: args.notes ?? null,
      })
      .returning({ id: procedureFollowups.id })

    if (args.outcome === 'desistiu') {
      await tx
        .update(procedureRecords)
        .set({
          status: 'cancelled',
          cancelledAt: now,
          cancellationReason: 'patient_declined',
          lastContactedAt: now,
          updatedAt: now,
        })
        .where(eq(procedureRecords.id, args.procedureRecordId))

      // Mirror the dedicated /cancel route: approved procedures have live
      // financial entries that must also be cancelled.
      if (proc.status === 'approved') {
        await cancelLinkedFinancials(tx, args.tenantId, args.procedureRecordId)
      }

      return {
        followupId: followup.id,
        cancelledProcedure: true,
        previousStatus: proc.status,
      }
    }

    await tx
      .update(procedureRecords)
      .set({ lastContactedAt: now, updatedAt: now })
      .where(eq(procedureRecords.id, args.procedureRecordId))

    return {
      followupId: followup.id,
      cancelledProcedure: false,
      previousStatus: proc.status,
    }
  })
}

export interface SnoozeProcedureArgs {
  tenantId: string
  procedureRecordId: string
  until: string | null
}

/**
 * Sets (or clears) the followup snooze date on a procedure record. Verifies
 * tenant ownership in the WHERE clause — if the row does not belong to the
 * tenant, nothing happens (returns false).
 */
export async function snoozeProcedure(args: SnoozeProcedureArgs): Promise<boolean> {
  const result = await db
    .update(procedureRecords)
    .set({ followupSnoozedUntil: args.until, updatedAt: new Date() })
    .where(
      and(
        eq(procedureRecords.id, args.procedureRecordId),
        eq(procedureRecords.tenantId, args.tenantId),
        isNull(procedureRecords.deletedAt),
      ),
    )
    .returning({ id: procedureRecords.id })

  return result.length > 0
}
