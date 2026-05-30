import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import { db } from '@/db/client'
import {
  patientEvolutionRevisions,
  patientEvolutions,
  procedureRecords,
  procedureSessions,
  procedureTypes,
  users,
} from '@/db/schema'

// ─── Types ──────────────────────────────────────────────────────────

/**
 * A single product applied during a procedure session, surfaced in the
 * evoluções feed. The `totalQuantity` is kept as a string because Drizzle
 * returns Postgres `numeric` values as strings to avoid precision loss.
 */
export interface EvolutionFeedProductApplication {
  productName: string
  totalQuantity: string
  quantityUnit: string
}

/**
 * Free-text loose note authored by clinical staff. Surfaced in the feed
 * via `EvolutionFeedEntry` and also returned standalone by the locked-read
 * helpers used by the edit/delete flows.
 */
export interface EvolutionNote {
  id: string
  tenantId: string
  patientId: string
  body: string
  authorId: string
  authorName: string
  occurredAt: Date
  createdAt: Date
  updatedAt: Date
  deletedAt: Date | null
  deletedBy: string | null
  deleteReason: string | null
  revisionCount: number
}

/**
 * One row of the audit trail attached to a `patient_evolutions` note. Each
 * revision is the PRE-edit snapshot — created at the moment a user submits
 * an edit, before the live row is updated.
 */
export interface EvolutionRevision {
  id: string
  evolutionId: string
  body: string
  occurredAt: Date
  editedBy: string
  editedByName: string
  editedAt: Date
}

/**
 * Read-only session payload surfaced in the evoluções feed. Pulled from
 * `procedure_sessions` joined to the parent record/type so the feed can
 * render technique/clinical notes inline. `productApplications` and
 * `diagramPointCount` are scoped to the session, with a legacy fallback
 * to record-scoped rows (procedure_session_id IS NULL) per RA-3.
 */
export interface EvolutionFeedSession {
  id: string
  occurredAt: Date
  executedById: string
  executedByName: string
  procedureRecordId: string
  procedureTypeName: string
  sessionOrdinal: number
  sessionsTotal: number
  recordStatus: string
  technique: string | null
  clinicalResponse: string | null
  adverseEffects: string | null
  notes: string | null
  followUpDate: string | null
  nextSessionObjectives: string | null
  productApplications: EvolutionFeedProductApplication[]
  diagramPointCount: number
}

/**
 * Discriminated union returned from `getPatientEvolutionFeed`. Both kinds
 * carry an `id` and `occurredAt`; consumers branch on `kind` to access the
 * note-only or session-only payload. Sorting is `(occurredAt DESC, id DESC)`
 * per RA-8 — no `createdAt` tiebreaker (sessions don't carry one comparable
 * across kinds, and `id` is a stable monotone-ish UUID).
 */
export type EvolutionFeedEntry =
  | ({ kind: 'note' } & EvolutionNote)
  | ({ kind: 'session' } & EvolutionFeedSession)

// ─── Shared feed extractor (RA-2) ───────────────────────────────────

/**
 * The single source of truth for the evoluções feed. Both the GET feed
 * route and the print page MUST call this — do not duplicate the merge
 * and sort logic.
 *
 * Merges:
 *  - non-deleted free-text notes from `patient_evolutions`
 *  - executed `procedure_sessions` for the patient (incl. cancelled records,
 *    so the clinical narrative survives even if the record was later voided)
 *
 * Tenant-scoped on both streams; patient-scoped on notes directly and on
 * sessions through the parent `procedure_records.patient_id`.
 *
 * Per RA-3, the session→feed mapping uses a legacy fallback: when zero
 * `product_applications` / `face_diagrams` rows match by
 * `procedure_session_id`, we fall back to record-scoped rows
 * (`procedure_record_id = session.procedure_record_id AND procedure_session_id IS NULL`).
 * Mirrors the pattern in `face-diagrams.ts` / `product-applications.ts`.
 */
export async function getPatientEvolutionFeed(
  tenantId: string,
  patientId: string,
): Promise<EvolutionFeedEntry[]> {
  const [notes, sessions] = await Promise.all([
    listNotesForPatient(tenantId, patientId),
    listSessionsForPatient(tenantId, patientId),
  ])

  const noteEntries: EvolutionFeedEntry[] = notes.map((n) => ({ kind: 'note', ...n }))
  const sessionEntries: EvolutionFeedEntry[] = sessions.map((s) => ({ kind: 'session', ...s }))

  return [...noteEntries, ...sessionEntries].sort((a, b) => {
    const ao = a.occurredAt.getTime()
    const bo = b.occurredAt.getTime()
    if (ao !== bo) return bo - ao
    // Stable tiebreak per RA-8: id DESC. UUIDs sort lexicographically;
    // monotone-ish enough to keep ordering stable across refetches.
    if (a.id < b.id) return 1
    if (a.id > b.id) return -1
    return 0
  })
}

// ─── Notes ──────────────────────────────────────────────────────────

/**
 * Non-deleted notes for a patient, with author name and edit-count
 * resolved. Tenant + patient scoped. Used by `getPatientEvolutionFeed`.
 */
async function listNotesForPatient(
  tenantId: string,
  patientId: string,
): Promise<EvolutionNote[]> {
  const revisionCount = sql<number>`(
    SELECT COUNT(*)::int FROM floraclin.patient_evolution_revisions r
    WHERE r.evolution_id = ${patientEvolutions.id}
  )`

  return db
    .select({
      id: patientEvolutions.id,
      tenantId: patientEvolutions.tenantId,
      patientId: patientEvolutions.patientId,
      body: patientEvolutions.body,
      authorId: patientEvolutions.authorId,
      authorName: users.fullName,
      occurredAt: patientEvolutions.occurredAt,
      createdAt: patientEvolutions.createdAt,
      updatedAt: patientEvolutions.updatedAt,
      deletedAt: patientEvolutions.deletedAt,
      deletedBy: patientEvolutions.deletedBy,
      deleteReason: patientEvolutions.deleteReason,
      revisionCount,
    })
    .from(patientEvolutions)
    .innerJoin(users, eq(patientEvolutions.authorId, users.id))
    .where(
      and(
        eq(patientEvolutions.tenantId, tenantId),
        eq(patientEvolutions.patientId, patientId),
        isNull(patientEvolutions.deletedAt),
      ),
    )
    .orderBy(desc(patientEvolutions.occurredAt), desc(patientEvolutions.id))
}

/**
 * Acquire a row-level `FOR UPDATE` lock on a single note. Per RA-1, scopes
 * by `(tenant_id, patient_id, id)` AND `deleted_at IS NULL` so:
 *   - cross-tenant ID guessing is refused,
 *   - notes belonging to a different patient on the same tenant are refused
 *     (return null — the route maps this to 404, not 403/500),
 *   - already-soft-deleted notes are refused.
 *
 * Returns the locked row, or `null` if no row matches. MUST be called
 * inside a transaction — outside one, the lock is released immediately
 * and the race protection disappears.
 */
export async function getNoteLockedForUpdate(
  tx: typeof db,
  tenantId: string,
  patientId: string,
  noteId: string,
): Promise<EvolutionNote | null> {
  const result = await tx.execute(sql`
    SELECT
      pe.id,
      pe.tenant_id,
      pe.patient_id,
      pe.body,
      pe.author_id,
      u.full_name AS author_name,
      pe.occurred_at,
      pe.created_at,
      pe.updated_at,
      pe.deleted_at,
      pe.deleted_by,
      pe.delete_reason
    FROM floraclin.patient_evolutions pe
    INNER JOIN floraclin.users u ON u.id = pe.author_id
    WHERE pe.tenant_id = ${tenantId}
      AND pe.patient_id = ${patientId}
      AND pe.id = ${noteId}
      AND pe.deleted_at IS NULL
    FOR UPDATE OF pe
  `)
  const rows = (Array.isArray(result)
    ? result
    : (result as { rows?: Record<string, unknown>[] }).rows ?? result) as Record<string, unknown>[]
  if (rows.length === 0) return null
  const r = rows[0]
  return {
    id: String(r.id),
    tenantId: String(r.tenant_id),
    patientId: String(r.patient_id),
    body: String(r.body),
    authorId: String(r.author_id),
    authorName: r.author_name ? String(r.author_name) : '',
    occurredAt: new Date(String(r.occurred_at)),
    createdAt: new Date(String(r.created_at)),
    updatedAt: new Date(String(r.updated_at)),
    deletedAt: r.deleted_at ? new Date(String(r.deleted_at)) : null,
    deletedBy: r.deleted_by ? String(r.deleted_by) : null,
    deleteReason: r.delete_reason ? String(r.delete_reason) : null,
    // revisionCount intentionally not selected in the locked read — callers
    // of the locked path (edit/delete) don't need it.
    revisionCount: 0,
  }
}

/**
 * List the edit history for a single note, in `editedAt DESC` order.
 *
 * Per RA-1, enforces ownership by joining through `patient_evolutions` and
 * filtering by `(tenant_id, patient_id, evolution_id)`. If the parent note
 * doesn't belong to the route's `(tenantId, patientId)` pair, returns
 * `null` so the API layer can map to 404 — distinct from `[]`, which means
 * "the note exists but has never been edited".
 */
export async function listRevisions(
  tenantId: string,
  patientId: string,
  noteId: string,
): Promise<EvolutionRevision[] | null> {
  // First, verify the parent note belongs to (tenantId, patientId). We
  // accept soft-deleted parents here — operators may want to inspect
  // revisions even after a delete to understand what was lost. Tenant +
  // patient scope is still enforced.
  const [parent] = await db
    .select({ id: patientEvolutions.id })
    .from(patientEvolutions)
    .where(
      and(
        eq(patientEvolutions.tenantId, tenantId),
        eq(patientEvolutions.patientId, patientId),
        eq(patientEvolutions.id, noteId),
      ),
    )
    .limit(1)

  if (!parent) return null

  return db
    .select({
      id: patientEvolutionRevisions.id,
      evolutionId: patientEvolutionRevisions.evolutionId,
      body: patientEvolutionRevisions.body,
      occurredAt: patientEvolutionRevisions.occurredAt,
      editedBy: patientEvolutionRevisions.editedBy,
      editedByName: users.fullName,
      editedAt: patientEvolutionRevisions.editedAt,
    })
    .from(patientEvolutionRevisions)
    .innerJoin(users, eq(patientEvolutionRevisions.editedBy, users.id))
    .where(
      and(
        eq(patientEvolutionRevisions.tenantId, tenantId),
        eq(patientEvolutionRevisions.evolutionId, noteId),
      ),
    )
    .orderBy(desc(patientEvolutionRevisions.editedAt))
}

// ─── Writes ─────────────────────────────────────────────────────────

/**
 * Insert a new note. Caller supplies tenantId + patientId + authorId so
 * the row is tenant-scoped from the start. `occurredAt` defaults to
 * `now()` at the DB layer when omitted.
 */
export async function insertNote(
  tx: typeof db,
  args: {
    tenantId: string
    patientId: string
    authorId: string
    body: string
    occurredAt?: Date | null
  },
): Promise<typeof patientEvolutions.$inferSelect> {
  const [row] = await tx
    .insert(patientEvolutions)
    .values({
      tenantId: args.tenantId,
      patientId: args.patientId,
      authorId: args.authorId,
      body: args.body,
      ...(args.occurredAt ? { occurredAt: args.occurredAt } : {}),
    })
    .returning()
  return row
}

/**
 * Insert a pre-edit snapshot into `patient_evolution_revisions`. Called by
 * the service layer's `editNote` BEFORE applying the new field values to
 * the live row, so the audit trail always carries the prior state.
 */
export async function insertRevisionSnapshot(
  tx: typeof db,
  args: {
    tenantId: string
    evolutionId: string
    body: string
    occurredAt: Date
    editedBy: string
  },
): Promise<typeof patientEvolutionRevisions.$inferSelect> {
  const [row] = await tx
    .insert(patientEvolutionRevisions)
    .values({
      tenantId: args.tenantId,
      evolutionId: args.evolutionId,
      body: args.body,
      occurredAt: args.occurredAt,
      editedBy: args.editedBy,
    })
    .returning()
  return row
}

/**
 * Apply field changes to a note and bump `updatedAt`. Either `body` or
 * `occurredAt` (or both) may be supplied. The caller is expected to have
 * already taken a `FOR UPDATE` lock via `getNoteLockedForUpdate`, so this
 * helper does NOT re-check tenant/patient ownership — the lock did.
 */
export async function updateNoteFields(
  tx: typeof db,
  noteId: string,
  fields: { body?: string; occurredAt?: Date },
): Promise<typeof patientEvolutions.$inferSelect> {
  const set: Record<string, unknown> = { updatedAt: new Date() }
  if (fields.body !== undefined) set.body = fields.body
  if (fields.occurredAt !== undefined) set.occurredAt = fields.occurredAt

  const [row] = await tx
    .update(patientEvolutions)
    .set(set)
    .where(eq(patientEvolutions.id, noteId))
    .returning()
  return row
}

/**
 * Soft-delete a note by stamping `deletedAt/deletedBy/deleteReason`. The
 * row is preserved so the audit/print views and the revision history
 * remain queryable. Caller MUST have taken a `FOR UPDATE` lock first.
 */
export async function softDeleteNote(
  tx: typeof db,
  noteId: string,
  args: { deletedBy: string; deleteReason: string | null },
): Promise<typeof patientEvolutions.$inferSelect> {
  const now = new Date()
  const [row] = await tx
    .update(patientEvolutions)
    .set({
      deletedAt: now,
      deletedBy: args.deletedBy,
      deleteReason: args.deleteReason,
      updatedAt: now,
    })
    .where(eq(patientEvolutions.id, noteId))
    .returning()
  return row
}

// ─── Sessions (for the feed) ────────────────────────────────────────

/**
 * Fetch executed `procedure_sessions` for a patient and project them into
 * the feed shape. Includes sessions whose parent record was later
 * cancelled (RA spec calls for the clinical narrative to survive — the
 * `recordStatus` field is passed through so the UI can render a "linha
 * cancelada" badge). Soft-deleted records ARE excluded.
 *
 * Per RA-3, the `productApplications` and `diagramPointCount` aggregations
 * scope by `procedure_session_id`; if zero rows match, they fall back to
 * record-scoped rows (`procedure_record_id = session.procedure_record_id
 * AND procedure_session_id IS NULL`) — mirrors `face-diagrams.ts` and
 * `product-applications.ts`.
 */
async function listSessionsForPatient(
  tenantId: string,
  patientId: string,
): Promise<EvolutionFeedSession[]> {
  // Per-session product applications, falling back to record-scoped rows
  // (procedure_session_id IS NULL) when the session has none. The fallback
  // surfaces pre-session-scoping data without leaking sibling sessions'
  // applications.
  const productAppsAgg = sql<EvolutionFeedProductApplication[]>`(
    SELECT COALESCE(json_agg(
      json_build_object(
        'productName', pa.product_name,
        'totalQuantity', pa.total_quantity,
        'quantityUnit', pa.quantity_unit
      )
      ORDER BY pa.product_name
    ), '[]'::json)
    FROM floraclin.product_applications pa
    WHERE pa.tenant_id = ${tenantId}
      AND (
        pa.procedure_session_id = ${procedureSessions.id}
        OR (
          NOT EXISTS (
            SELECT 1 FROM floraclin.product_applications pa_inner
            WHERE pa_inner.procedure_session_id = ${procedureSessions.id}
          )
          AND pa.procedure_record_id = ${procedureRecords.id}
          AND pa.procedure_session_id IS NULL
        )
      )
  )`

  // Per-session diagram point count, with the same fallback semantics.
  const diagramPointCount = sql<number>`(
    SELECT COALESCE(SUM(pt_count), 0)::int FROM (
      SELECT (
        SELECT COUNT(*)::int
        FROM floraclin.diagram_points dp
        WHERE dp.face_diagram_id = fd.id
      ) AS pt_count
      FROM floraclin.face_diagrams fd
      WHERE fd.tenant_id = ${tenantId}
        AND (
          fd.procedure_session_id = ${procedureSessions.id}
          OR (
            NOT EXISTS (
              SELECT 1 FROM floraclin.face_diagrams fd2
              WHERE fd2.procedure_session_id = ${procedureSessions.id}
            )
            AND fd.procedure_record_id = ${procedureRecords.id}
            AND fd.procedure_session_id IS NULL
          )
        )
    ) sub
  )`

  return db
    .select({
      id: procedureSessions.id,
      occurredAt: procedureSessions.performedAt,
      executedById: procedureSessions.executedBy,
      executedByName: users.fullName,
      procedureRecordId: procedureRecords.id,
      procedureTypeName: procedureTypes.name,
      sessionOrdinal: procedureSessions.sessionOrdinal,
      sessionsTotal: procedureRecords.sessionsTotal,
      recordStatus: procedureRecords.status,
      technique: procedureSessions.technique,
      clinicalResponse: procedureSessions.clinicalResponse,
      adverseEffects: procedureSessions.adverseEffects,
      notes: procedureSessions.notes,
      followUpDate: procedureSessions.followUpDate,
      nextSessionObjectives: procedureSessions.nextSessionObjectives,
      productApplications: productAppsAgg,
      diagramPointCount,
    })
    .from(procedureSessions)
    .innerJoin(users, eq(procedureSessions.executedBy, users.id))
    .innerJoin(procedureRecords, eq(procedureSessions.procedureRecordId, procedureRecords.id))
    .innerJoin(procedureTypes, eq(procedureRecords.procedureTypeId, procedureTypes.id))
    .where(
      and(
        eq(procedureSessions.tenantId, tenantId),
        // Defense-in-depth: scope joined rows by tenant too. The join keys
        // are scoped UUIDs in practice, but predicating the joined tables
        // directly matches the pattern used elsewhere (see procedures.ts)
        // and would catch a misjoined/cross-tenant row.
        eq(procedureRecords.tenantId, tenantId),
        eq(procedureTypes.tenantId, tenantId),
        eq(procedureRecords.patientId, patientId),
        isNull(procedureRecords.deletedAt),
      ),
    )
    .orderBy(desc(procedureSessions.performedAt), desc(procedureSessions.id))
    .then((rows) =>
      rows.map((r) => ({
        ...r,
        productApplications: Array.isArray(r.productApplications) ? r.productApplications : [],
        diagramPointCount: Number(r.diagramPointCount ?? 0),
      })),
    )
}
