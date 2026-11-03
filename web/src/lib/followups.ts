import { db } from '@/db/client'
import { faceDiagramGroups, procedureFollowups, procedureRecords } from '@/db/schema'
import { lockDiagramGroup, releaseStandaloneGroups } from '@/db/queries/face-diagram-groups'
import { cancelLinkedFinancials } from '@/db/queries/financial'
import { withTransaction } from '@/lib/tenant'
import { createAuditLog } from '@/lib/audit'
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
  releasedDiagramGroupIds: string[]
}

// Statuses from which a followup of outcome === 'desistiu' may flip the
// procedure into `cancelled`. Cancelled / executed / draft procedures must
// NOT be transitioned through this path — those flows belong to the dedicated
// `/cancel` route (draft) or are simply not legal (executed/cancelled).
const DESISTIU_ALLOWED_FROM_STATUSES = new Set(['planned', 'approved'])

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
 *  - If previous status was 'approved', cancels the live linked financial
 *    entries and their pending installments (mirrors the /cancel route).
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
  return withTransaction(async (tx) => {
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
          eq(procedureRecords.tenantId, args.tenantId),
          isNull(procedureRecords.deletedAt),
        ),
      )
      .for('update')
      .limit(1)

    if (!proc) {
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

      const releasedDiagramGroupIds = await releaseStandaloneGroups(tx, args.tenantId, [args.procedureRecordId])

      // Mirror the dedicated /cancel route: approved procedures have live
      // financial entries that must also be cancelled.
      if (proc.status === 'approved') {
        await cancelLinkedFinancials(
          tx,
          args.tenantId,
          args.contactedBy,
          args.procedureRecordId,
          'Paciente desistiu do procedimento',
        )
      }

      return {
        followupId: followup.id,
        cancelledProcedure: true,
        previousStatus: proc.status,
        releasedDiagramGroupIds,
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
      releasedDiagramGroupIds: [],
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

export interface RecordDiagramFollowupArgs {
  tenantId: string
  groupId: string
  userId: string
  channel: FollowupChannel
  outcome: FollowupOutcome
  notes?: string | null
}

export interface RecordDiagramFollowupResult {
  followupId: string
  declined: boolean
}

export const DIAGRAM_NOT_FOUND = 'Diagram group not found'
export const DIAGRAM_NOT_AWAITING = 'Diagram quote is not awaiting an answer'

/**
 * Records a contact attempt on a standalone quotation. Outcome 'desistiu'
 * marks the quotation as declined.
 */
export async function recordDiagramFollowup(
  args: RecordDiagramFollowupArgs,
): Promise<RecordDiagramFollowupResult> {
  return withTransaction(async (tx) => {
    const group = await lockDiagramGroup(tx, args.tenantId, args.groupId)
    if (!group) throw new Error(DIAGRAM_NOT_FOUND)
    if (group.status !== 'quote') throw new Error(DIAGRAM_NOT_AWAITING)

    const now = new Date()
    const [followup] = await tx
      .insert(procedureFollowups)
      .values({
        tenantId: args.tenantId,
        faceDiagramGroupId: args.groupId,
        contactedBy: args.userId,
        contactedAt: now,
        channel: args.channel,
        outcome: args.outcome,
        notes: args.notes ?? null,
      })
      .returning({ id: procedureFollowups.id })

    const declined = args.outcome === 'desistiu'
    await tx
      .update(faceDiagramGroups)
      .set({
        lastContactedAt: now,
        updatedAt: now,
        ...(declined ? { declinedAt: now } : {}),
      })
      .where(eq(faceDiagramGroups.id, args.groupId))

    await createAuditLog(
      {
        tenantId: args.tenantId,
        userId: args.userId,
        action: 'create',
        entityType: 'procedure_followup',
        entityId: followup.id,
        changes: {
          followup: {
            old: null,
            new: {
              faceDiagramGroupId: args.groupId,
              channel: args.channel,
              outcome: args.outcome,
              notes: args.notes ?? null,
            },
          },
          ...(declined ? { declinedAt: { old: null, new: now.toISOString() } } : {}),
        },
      },
      tx,
    )

    return { followupId: followup.id, declined }
  })
}

export interface SnoozeDiagramGroupArgs {
  tenantId: string
  groupId: string
  userId: string
  until: string | null
}

export async function snoozeDiagramGroup(args: SnoozeDiagramGroupArgs): Promise<void> {
  await withTransaction(async (tx) => {
    const group = await lockDiagramGroup(tx, args.tenantId, args.groupId)
    if (!group) throw new Error(DIAGRAM_NOT_FOUND)
    if (group.status !== 'quote') throw new Error(DIAGRAM_NOT_AWAITING)

    await tx
      .update(faceDiagramGroups)
      .set({ followupSnoozedUntil: args.until, updatedAt: new Date() })
      .where(eq(faceDiagramGroups.id, args.groupId))

    await createAuditLog(
      {
        tenantId: args.tenantId,
        userId: args.userId,
        action: 'update',
        entityType: 'face_diagram_group',
        entityId: args.groupId,
        changes: { followupSnoozedUntil: { old: null, new: args.until } },
      },
      tx,
    )
  })
}
