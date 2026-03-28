'use server'

import { requireRole, getAuthContext } from '@/lib/auth'
import { withTransaction } from '@/lib/tenant'
import { createAuditLog } from '@/lib/audit'
import { diagramSaveSchema } from '@/validations/procedure'
import { saveFaceDiagram, getFaceDiagram, getPreviousDiagramPoints } from '@/db/queries/face-diagrams'
import type { DiagramViewType } from '@/types'

// ─── Types ──────────────────────────────────────────────────────────

export type FaceDiagramActionResult = {
  success: boolean
  error?: string
  fieldErrors?: Record<string, string[]>
  data?: unknown
}

// ─── Save Face Diagram (within Transaction) ─────────────────────────

export async function saveFaceDiagramAction(
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
  }>
): Promise<FaceDiagramActionResult> {
  const ctx = await requireRole('owner', 'practitioner')

  const parsed = diagramSaveSchema.safeParse({
    procedureRecordId,
    viewType,
    points,
  })

  if (!parsed.success) {
    return { success: false, fieldErrors: parsed.error.flatten().fieldErrors }
  }

  try {
    const diagramId = await withTransaction(async (tx) => {
      return saveFaceDiagram(
        ctx.tenantId,
        procedureRecordId,
        viewType,
        points,
        tx
      )
    })

    await createAuditLog({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'update',
      entityType: 'face_diagram',
      entityId: diagramId,
      changes: {
        procedureRecordId: { old: null, new: procedureRecordId },
        viewType: { old: null, new: viewType },
        pointCount: { old: null, new: points.length },
      },
    })

    return { success: true, data: { diagramId } }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Erro ao salvar diagrama',
    }
  }
}

// ─── Get Face Diagram ───────────────────────────────────────────────

export async function getFaceDiagramAction(procedureRecordId: string) {
  const ctx = await getAuthContext()
  const diagrams = await getFaceDiagram(ctx.tenantId, procedureRecordId)
  return { success: true, data: diagrams }
}

// ─── Get Previous Diagram Points ────────────────────────────────────

export async function getPreviousDiagramPointsAction(
  patientId: string,
  excludeProcedureId?: string
) {
  const ctx = await getAuthContext()
  const points = await getPreviousDiagramPoints(ctx.tenantId, patientId, excludeProcedureId)
  return { success: true, data: points }
}
