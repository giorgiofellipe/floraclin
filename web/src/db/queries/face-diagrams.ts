import { db } from '@/db/client'
import { faceDiagrams, faceDiagramGroups, diagramPoints, procedureRecords } from '@/db/schema'
import { and, desc, eq, exists, isNotNull, isNull, ne, or, sql } from 'drizzle-orm'
import type { DiagramViewType } from '@/types'
import {
  ensureSessionGroup,
  loadDiagramsWithPoints,
  lockDiagramGroup,
  writeGroupView,
} from './face-diagram-groups'

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

export interface DiagramPointInput {
  x: number
  y: number
  productName: string
  activeIngredient?: string
  quantity: number
  quantityUnit: string
  technique?: string
  depth?: string
  notes?: string
}

// ─── Queries ────────────────────────────────────────────────────────

export async function saveFaceDiagram(
  tenantId: string,
  groupId: string,
  viewType: DiagramViewType,
  points: DiagramPointInput[],
  txDb: typeof db = db
): Promise<string | null> {
  const group = await lockDiagramGroup(txDb, tenantId, groupId)
  if (!group) throw new Error('Diagrama não encontrado')
  return writeGroupView(txDb, tenantId, groupId, viewType, points)
}

export async function saveFaceDiagramForSession(
  tenantId: string,
  input: {
    patientId: string
    practitionerId: string
    procedureRecordId: string
    procedureSessionId: string
  },
  viewType: DiagramViewType,
  points: DiagramPointInput[],
  txDb: typeof db = db
): Promise<string | null> {
  if (points.length === 0) return null
  const groupId = await ensureSessionGroup(txDb, { tenantId, ...input })
  return saveFaceDiagram(tenantId, groupId, viewType, points, txDb)
}

export async function listDiagramsForSession(
  tenantId: string,
  procedureSessionId: string,
  txDb: typeof db = db
): Promise<DiagramWithPoints[]> {
  const rows = await txDb
    .select({ id: faceDiagrams.id, viewType: faceDiagrams.viewType })
    .from(faceDiagrams)
    .innerJoin(faceDiagramGroups, eq(faceDiagramGroups.id, faceDiagrams.groupId))
    .where(
      and(
        eq(faceDiagramGroups.tenantId, tenantId),
        eq(faceDiagramGroups.procedureSessionId, procedureSessionId),
        isNull(faceDiagramGroups.deletedAt),
      ),
    )
  return loadDiagramsWithPoints(txDb, rows)
}

/** Planning and session diagrams of a procedure record. */
export async function getFaceDiagram(
  tenantId: string,
  procedureRecordId: string,
  txDb: typeof db = db
): Promise<DiagramWithPoints[]> {
  const rows = await txDb
    .select({ id: faceDiagrams.id, viewType: faceDiagrams.viewType })
    .from(faceDiagrams)
    .innerJoin(faceDiagramGroups, eq(faceDiagramGroups.id, faceDiagrams.groupId))
    .where(
      and(
        eq(faceDiagramGroups.tenantId, tenantId),
        eq(faceDiagramGroups.procedureRecordId, procedureRecordId),
        isNull(faceDiagramGroups.deletedAt),
      ),
    )
  return loadDiagramsWithPoints(txDb, rows)
}

/**
 * Every view of the patient's latest applied diagram group (a session, or the
 * planning of a completed procedure), for the ghost overlay in the editor.
 */
export async function getPreviousDiagramPoints(
  tenantId: string,
  patientId: string,
  excludeProcedureId?: string
): Promise<(DiagramPointRecord & { viewType: DiagramViewType })[]> {
  const conditions = [
    eq(faceDiagramGroups.tenantId, tenantId),
    eq(faceDiagramGroups.patientId, patientId),
    isNull(faceDiagramGroups.deletedAt),
    isNull(procedureRecords.deletedAt),
    or(
      isNotNull(faceDiagramGroups.procedureSessionId),
      eq(procedureRecords.status, 'completed'),
    )!,
    exists(
      db
        .select({ one: sql`1` })
        .from(faceDiagrams)
        .innerJoin(diagramPoints, eq(diagramPoints.faceDiagramId, faceDiagrams.id))
        .where(eq(faceDiagrams.groupId, faceDiagramGroups.id))
    ),
  ]
  if (excludeProcedureId) {
    conditions.push(ne(faceDiagramGroups.procedureRecordId, excludeProcedureId))
  }

  const [latest] = await db
    .select({ id: faceDiagramGroups.id })
    .from(faceDiagramGroups)
    .innerJoin(procedureRecords, eq(procedureRecords.id, faceDiagramGroups.procedureRecordId))
    .where(and(...conditions))
    .orderBy(desc(faceDiagramGroups.createdAt))
    .limit(1)
  if (!latest) return []

  const rows = await db
    .select({ point: diagramPoints, viewType: faceDiagrams.viewType })
    .from(diagramPoints)
    .innerJoin(faceDiagrams, eq(faceDiagrams.id, diagramPoints.faceDiagramId))
    .where(and(eq(faceDiagrams.groupId, latest.id), eq(faceDiagrams.tenantId, tenantId)))
    .orderBy(faceDiagrams.viewType, diagramPoints.sortOrder)

  return rows.map((r) => ({ ...r.point, viewType: r.viewType as DiagramViewType }))
}
