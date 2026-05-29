import { db } from '@/db/client'
import { faceDiagrams, diagramPoints, procedureSessions } from '@/db/schema'
import { eq, and, desc, ne } from 'drizzle-orm'
import type { DiagramViewType } from '@/types'

// ─── Types ──────────────────────────────────────────────────────────

export interface DiagramWithPoints {
  id: string
  viewType: string
  points: DiagramPointRecord[]
}

export interface DiagramPointRecord {
  id: string
  x: string
  y: string
  productName: string
  activeIngredient: string | null
  quantity: string
  quantityUnit: string
  technique: string | null
  depth: string | null
  notes: string | null
  sortOrder: number
}

// ─── Queries ────────────────────────────────────────────────────────

/**
 * Upsert a face diagram for a specific procedure session and replace its points.
 *
 * Writes are session-scoped: lookup is by `(procedureSessionId, viewType)` per the
 * `uq_face_diagrams_session_view` partial unique constraint (where
 * `procedure_session_id IS NOT NULL`). The `procedureRecordId` is still stored on
 * the row so reads can aggregate per-record.
 */
export async function saveFaceDiagramForSession(
  tenantId: string,
  procedureRecordId: string,
  procedureSessionId: string,
  viewType: DiagramViewType,
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
  }>,
  txDb: typeof db = db
) {
  // Upsert diagram: find existing by (session, viewType) per uq_face_diagrams_session_view
  const existing = await txDb
    .select()
    .from(faceDiagrams)
    .where(
      and(
        eq(faceDiagrams.tenantId, tenantId),
        eq(faceDiagrams.procedureSessionId, procedureSessionId),
        eq(faceDiagrams.viewType, viewType)
      )
    )
    .limit(1)

  let diagramId: string

  if (existing.length > 0) {
    diagramId = existing[0].id

    // Update timestamp
    await txDb
      .update(faceDiagrams)
      .set({ updatedAt: new Date() })
      .where(eq(faceDiagrams.id, diagramId))

    // Delete existing points (cascade replacement)
    await txDb
      .delete(diagramPoints)
      .where(eq(diagramPoints.faceDiagramId, diagramId))
  } else {
    const [diagram] = await txDb
      .insert(faceDiagrams)
      .values({
        tenantId,
        procedureRecordId,
        procedureSessionId,
        viewType,
      })
      .returning()

    diagramId = diagram.id
  }

  // Insert new points
  if (points.length > 0) {
    await txDb.insert(diagramPoints).values(
      points.map((point, index) => ({
        tenantId,
        faceDiagramId: diagramId,
        x: point.x.toFixed(2),
        y: point.y.toFixed(2),
        productName: point.productName,
        activeIngredient: point.activeIngredient ?? null,
        quantity: point.quantity.toFixed(2),
        quantityUnit: point.quantityUnit,
        technique: point.technique ?? null,
        depth: point.depth ?? null,
        notes: point.notes ?? null,
        sortOrder: index,
      }))
    )
  }

  return diagramId
}

/**
 * List all diagrams (with their points) for a specific procedure session.
 */
export async function listDiagramsForSession(
  procedureSessionId: string,
  txDb: typeof db = db
): Promise<DiagramWithPoints[]> {
  const diagrams = await txDb
    .select()
    .from(faceDiagrams)
    .where(eq(faceDiagrams.procedureSessionId, procedureSessionId))

  const result: DiagramWithPoints[] = []

  for (const diagram of diagrams) {
    const points = await txDb
      .select()
      .from(diagramPoints)
      .where(eq(diagramPoints.faceDiagramId, diagram.id))
      .orderBy(diagramPoints.sortOrder)

    result.push({
      id: diagram.id,
      viewType: diagram.viewType,
      points,
    })
  }

  return result
}

/**
 * List diagrams for a procedure record, returning the LAST session's diagrams
 * (ordered by session ordinal DESC). Used by the step-5 picker to seed the
 * editor with the most recent session's points as a starting point.
 *
 * Falls back to legacy record-scoped diagrams (rows where procedureSessionId
 * IS NULL) if no session-scoped diagrams exist for the record.
 */
export async function listDiagramsForRecord(
  procedureRecordId: string,
  txDb: typeof db = db
): Promise<DiagramWithPoints[]> {
  // Find the most recent session (highest ordinal) for this record that has
  // any diagrams attached.
  const latestSession = await txDb
    .select({ id: procedureSessions.id })
    .from(procedureSessions)
    .innerJoin(faceDiagrams, eq(faceDiagrams.procedureSessionId, procedureSessions.id))
    .where(eq(procedureSessions.procedureRecordId, procedureRecordId))
    .orderBy(desc(procedureSessions.sessionOrdinal))
    .limit(1)

  if (latestSession.length > 0) {
    return listDiagramsForSession(latestSession[0].id, txDb)
  }

  // Legacy fallback: record-scoped rows (procedureSessionId IS NULL) written
  // before B6. New writes are session-scoped, but reads still need to surface
  // pre-migration data.
  const legacy = await txDb
    .select()
    .from(faceDiagrams)
    .where(eq(faceDiagrams.procedureRecordId, procedureRecordId))

  const result: DiagramWithPoints[] = []
  for (const diagram of legacy) {
    const points = await txDb
      .select()
      .from(diagramPoints)
      .where(eq(diagramPoints.faceDiagramId, diagram.id))
      .orderBy(diagramPoints.sortOrder)

    result.push({
      id: diagram.id,
      viewType: diagram.viewType,
      points,
    })
  }

  return result
}

export async function getFaceDiagram(
  tenantId: string,
  procedureRecordId: string
): Promise<DiagramWithPoints[]> {
  const diagrams = await db
    .select()
    .from(faceDiagrams)
    .where(
      and(
        eq(faceDiagrams.tenantId, tenantId),
        eq(faceDiagrams.procedureRecordId, procedureRecordId)
      )
    )

  const result: DiagramWithPoints[] = []

  for (const diagram of diagrams) {
    const points = await db
      .select()
      .from(diagramPoints)
      .where(eq(diagramPoints.faceDiagramId, diagram.id))
      .orderBy(diagramPoints.sortOrder)

    result.push({
      id: diagram.id,
      viewType: diagram.viewType,
      points,
    })
  }

  return result
}

/**
 * Get the most recent diagram points for a patient (from the latest procedure).
 * Used for ghost overlay in the face diagram editor.
 */
export async function getPreviousDiagramPoints(
  tenantId: string,
  patientId: string,
  excludeProcedureId?: string
): Promise<DiagramPointRecord[]> {
  // Import procedureRecords here to avoid circular dependency at module level
  const { procedureRecords } = await import('@/db/schema')

  // Find the most recent procedure for this patient (excluding current)
  const conditions = [
    eq(faceDiagrams.tenantId, tenantId),
    eq(procedureRecords.patientId, patientId),
  ]

  if (excludeProcedureId) {
    conditions.push(ne(faceDiagrams.procedureRecordId, excludeProcedureId))
  }

  const latestDiagrams = await db
    .select({ id: faceDiagrams.id })
    .from(faceDiagrams)
    .innerJoin(
      procedureRecords,
      eq(faceDiagrams.procedureRecordId, procedureRecords.id)
    )
    .where(and(...conditions))
    .orderBy(desc(procedureRecords.performedAt))
    .limit(1)

  if (latestDiagrams.length === 0) return []

  const points = await db
    .select()
    .from(diagramPoints)
    .where(eq(diagramPoints.faceDiagramId, latestDiagrams[0].id))
    .orderBy(diagramPoints.sortOrder)

  return points
}
