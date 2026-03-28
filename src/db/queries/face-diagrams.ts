import { db } from '@/db/client'
import { faceDiagrams, diagramPoints } from '@/db/schema'
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

export async function saveFaceDiagram(
  tenantId: string,
  procedureRecordId: string,
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
  // Upsert diagram: find existing or create
  const existing = await txDb
    .select()
    .from(faceDiagrams)
    .where(
      and(
        eq(faceDiagrams.tenantId, tenantId),
        eq(faceDiagrams.procedureRecordId, procedureRecordId),
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
