import { patientEvolutions } from '@/db/schema'
import { createAuditLog } from '@/lib/audit'
import { BusinessError } from '@/lib/errors'
import { withTransaction } from '@/lib/tenant'
import {
  getNoteLockedForUpdate,
  insertNote,
  insertRevisionSnapshot,
  softDeleteNote as softDeleteNoteQuery,
  updateNoteFields,
} from '@/db/queries/patient-evolutions'

// All three service functions go through `withTransaction` (see
// web/src/lib/tenant.ts) rather than calling `db.transaction` directly.
// Drizzle's transaction callback receives a `PgTransaction` whose type
// lacks the `$client` field that the queries layer's `typeof db` requires;
// `withTransaction` already casts via `as unknown as typeof db` so the
// queries' signatures line up cleanly — matches the pattern used in
// `web/src/lib/packages.ts`.

/**
 * The row shape returned by the write helpers in
 * `@/db/queries/patient-evolutions`. The service returns this raw row (not the
 * enriched `EvolutionNote` with joined `authorName`/`revisionCount`) — callers
 * that need the enriched view re-fetch through `getPatientEvolutionFeed`.
 */
export type EvolutionNote = typeof patientEvolutions.$inferSelect

// ─── createNote ─────────────────────────────────────────────────────

export interface CreateNoteArgs {
  tenantId: string
  patientId: string
  authorId: string
  body: string
  occurredAt: Date | null
}

/**
 * Create a free-text loose note for a patient.
 *
 * Per RA-9, creation is NOT audit-logged — the note's appearance in the feed
 * is its own audit (we know the authorId, createdAt, and full body). Audit
 * logs are reserved for edits (via `patient_evolution_revisions`) and
 * deletes (which carry a separate `delete_reason`).
 *
 * Wrapped in a transaction even though it's a single insert today — keeps
 * the call shape consistent with `editNote`/`softDeleteNote` and gives us a
 * place to extend if downstream side-effects are added later.
 */
export async function createNote(args: CreateNoteArgs): Promise<EvolutionNote> {
  return withTransaction(async (tx) => {
    return insertNote(tx, {
      tenantId: args.tenantId,
      patientId: args.patientId,
      authorId: args.authorId,
      body: args.body,
      occurredAt: args.occurredAt,
    })
  })
}

// ─── editNote ───────────────────────────────────────────────────────

export interface EditNoteArgs {
  tenantId: string
  patientId: string
  noteId: string
  editorId: string
  body?: string
  occurredAt?: Date
}

/**
 * Edit an existing note. Inside a single transaction:
 *  1. Acquire a row-level `FOR UPDATE` lock scoped to
 *     `(tenantId, patientId, noteId)` — RA-1 enforcement. A miss here returns
 *     `BusinessError('EVOLUTION_NOTE_NOT_FOUND')`, which the API layer maps
 *     to 404. This same path catches cross-patient/cross-tenant ID guesses.
 *  2. Snapshot the PRE-edit body + occurredAt into `patient_evolution_revisions`.
 *     The revisions table IS the edit audit (RA-9), so we do NOT also call
 *     `createAuditLog` here — that would double-log.
 *  3. Apply the new field values to the live row.
 *
 * Returns the updated row.
 */
export async function editNote(args: EditNoteArgs): Promise<EvolutionNote> {
  return withTransaction(async (tx) => {
    const current = await getNoteLockedForUpdate(
      tx,
      args.tenantId,
      args.patientId,
      args.noteId,
    )
    if (!current) {
      throw new BusinessError(
        'EVOLUTION_NOTE_NOT_FOUND',
        'Evolução não encontrada',
      )
    }

    // Snapshot pre-edit state. We snapshot unconditionally — even if the
    // edit is a no-op (same body, same occurredAt), keeping a revision row
    // documents the fact that an edit was attempted.
    await insertRevisionSnapshot(tx, {
      tenantId: args.tenantId,
      evolutionId: args.noteId,
      body: current.body,
      occurredAt: current.occurredAt,
      editedBy: args.editorId,
    })

    const updated = await updateNoteFields(tx, args.noteId, {
      body: args.body,
      occurredAt: args.occurredAt,
    })

    return updated
  })
}

// ─── softDeleteNote ─────────────────────────────────────────────────

export interface SoftDeleteNoteArgs {
  tenantId: string
  patientId: string
  noteId: string
  deletedBy: string
  deleteReason: string | null
}

/**
 * Soft-delete a note. Inside a single transaction:
 *  1. Acquire a row-level `FOR UPDATE` lock scoped to
 *     `(tenantId, patientId, noteId)` — RA-1 enforcement. A miss returns
 *     `BusinessError('EVOLUTION_NOTE_NOT_FOUND')`, mapped to 404.
 *  2. Stamp `deletedAt`/`deletedBy`/`deleteReason` on the row.
 *  3. Write an audit log entry — RA-9: deletes ARE audited (they carry a
 *     stated `deleteReason` and there's no `patient_evolution_revisions`
 *     row for deletes, unlike edits).
 */
export async function softDeleteNote(args: SoftDeleteNoteArgs): Promise<void> {
  await withTransaction(async (tx) => {
    const current = await getNoteLockedForUpdate(
      tx,
      args.tenantId,
      args.patientId,
      args.noteId,
    )
    if (!current) {
      throw new BusinessError(
        'EVOLUTION_NOTE_NOT_FOUND',
        'Evolução não encontrada',
      )
    }

    await softDeleteNoteQuery(tx, args.noteId, {
      deletedBy: args.deletedBy,
      deleteReason: args.deleteReason,
    })

    await createAuditLog(
      {
        tenantId: args.tenantId,
        userId: args.deletedBy,
        action: 'delete',
        entityType: 'patient_evolution',
        entityId: args.noteId,
        changes: { reason: { old: null, new: args.deleteReason } },
      },
      tx,
    )
  })
}
