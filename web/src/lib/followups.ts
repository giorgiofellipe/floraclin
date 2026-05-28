import { db } from '@/db/client'
import { procedureFollowups, procedureRecords } from '@/db/schema'
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
 *
 * Throws if the procedure record does not belong to the given tenant.
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
      return { followupId: followup.id, cancelledProcedure: true }
    }

    await tx
      .update(procedureRecords)
      .set({ lastContactedAt: now, updatedAt: now })
      .where(eq(procedureRecords.id, args.procedureRecordId))

    return { followupId: followup.id, cancelledProcedure: false }
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
