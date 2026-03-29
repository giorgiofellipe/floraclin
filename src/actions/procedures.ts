'use server'

import { requireRole, getAuthContext } from '@/lib/auth'
import { withTransaction } from '@/lib/tenant'
import { createAuditLog } from '@/lib/audit'
import {
  createProcedureSchema,
  updateProcedureSchema,
} from '@/validations/procedure'
import {
  createProcedure,
  updateProcedure,
  getProcedure,
  listProcedures,
  listProcedureTypes,
  getLatestConsentForPatientType,
} from '@/db/queries/procedures'
import { saveFaceDiagram, getFaceDiagram, getPreviousDiagramPoints } from '@/db/queries/face-diagrams'
import { saveProductApplications, getProductApplications } from '@/db/queries/product-applications'
import type { DiagramViewType } from '@/types'
import type { ProductApplicationItem } from '@/validations/procedure'

// ─── Types ──────────────────────────────────────────────────────────

export type ProcedureActionResult = {
  success: boolean
  error?: string
  fieldErrors?: Record<string, string[]>
  data?: unknown
}

// ─── Create Procedure (with Transaction) ────────────────────────────

export async function createProcedureAction(
  formData: {
    patientId: string
    procedureTypeId: string
    additionalTypeIds?: string[]
    appointmentId?: string
    technique?: string
    clinicalResponse?: string
    adverseEffects?: string
    notes?: string
    followUpDate?: string
    nextSessionObjectives?: string
    diagrams?: Array<{
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
    }>
    productApplications?: ProductApplicationItem[]
  }
): Promise<ProcedureActionResult> {
  const ctx = await requireRole('owner', 'practitioner')

  const parsed = createProcedureSchema.safeParse({
    patientId: formData.patientId,
    procedureTypeId: formData.procedureTypeId,
    additionalTypeIds: formData.additionalTypeIds,
    appointmentId: formData.appointmentId,
    technique: formData.technique,
    clinicalResponse: formData.clinicalResponse,
    adverseEffects: formData.adverseEffects,
    notes: formData.notes,
    followUpDate: formData.followUpDate,
    nextSessionObjectives: formData.nextSessionObjectives,
  })

  if (!parsed.success) {
    return { success: false, fieldErrors: parsed.error.flatten().fieldErrors }
  }

  try {
    const result = await withTransaction(async (tx) => {
      // 1. Create procedure record
      const procedure = await createProcedure(
        ctx.tenantId,
        ctx.userId,
        parsed.data,
        tx
      )

      // 2. Save face diagrams and points
      if (formData.diagrams && formData.diagrams.length > 0) {
        for (const diagram of formData.diagrams) {
          await saveFaceDiagram(
            ctx.tenantId,
            procedure.id,
            diagram.viewType,
            diagram.points,
            tx
          )
        }
      }

      // 3. Save product applications
      if (formData.productApplications && formData.productApplications.length > 0) {
        await saveProductApplications(
          ctx.tenantId,
          procedure.id,
          formData.productApplications,
          tx
        )
      }

      return procedure
    })

    await createAuditLog({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'create',
      entityType: 'procedure_record',
      entityId: result.id,
      changes: {
        patientId: { old: null, new: formData.patientId },
        procedureTypeId: { old: null, new: formData.procedureTypeId },
      },
    })

    return { success: true, data: result }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Erro ao criar procedimento',
    }
  }
}

// ─── Update Procedure (with Transaction) ────────────────────────────

export async function updateProcedureAction(
  id: string,
  formData: {
    procedureTypeId?: string
    additionalTypeIds?: string[]
    appointmentId?: string
    technique?: string
    clinicalResponse?: string
    adverseEffects?: string
    notes?: string
    followUpDate?: string
    nextSessionObjectives?: string
    status?: 'in_progress' | 'completed' | 'cancelled'
    diagrams?: Array<{
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
    }>
    productApplications?: ProductApplicationItem[]
  }
): Promise<ProcedureActionResult> {
  const ctx = await requireRole('owner', 'practitioner')

  const parsed = updateProcedureSchema.safeParse({ id, ...formData })
  if (!parsed.success) {
    return { success: false, fieldErrors: parsed.error.flatten().fieldErrors }
  }

  try {
    const result = await withTransaction(async (tx) => {
      // 1. Update procedure record
      const procedure = await updateProcedure(ctx.tenantId, id, parsed.data, tx)
      if (!procedure) {
        throw new Error('Procedimento não encontrado')
      }

      // 2. Save face diagrams if provided
      if (formData.diagrams && formData.diagrams.length > 0) {
        for (const diagram of formData.diagrams) {
          await saveFaceDiagram(
            ctx.tenantId,
            id,
            diagram.viewType,
            diagram.points,
            tx
          )
        }
      }

      // 3. Save product applications if provided
      if (formData.productApplications !== undefined) {
        await saveProductApplications(
          ctx.tenantId,
          id,
          formData.productApplications,
          tx
        )
      }

      return procedure
    })

    await createAuditLog({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'update',
      entityType: 'procedure_record',
      entityId: id,
    })

    return { success: true, data: result }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Erro ao atualizar procedimento',
    }
  }
}

// ─── Get Procedure ──────────────────────────────────────────────────

export async function getProcedureAction(id: string) {
  const ctx = await getAuthContext()

  const procedure = await getProcedure(ctx.tenantId, id)
  if (!procedure) {
    return { success: false, error: 'Procedimento não encontrado' }
  }

  const diagrams = await getFaceDiagram(ctx.tenantId, id)
  const applications = await getProductApplications(ctx.tenantId, id)

  return {
    success: true,
    data: {
      ...procedure,
      diagrams,
      productApplications: applications,
    },
  }
}

// ─── List Procedures ────────────────────────────────────────────────

export async function listProceduresAction(patientId: string) {
  const ctx = await getAuthContext()
  const procedures = await listProcedures(ctx.tenantId, patientId)
  return { success: true, data: procedures }
}

// ─── List Procedure Types ───────────────────────────────────────────

export async function listProcedureTypesAction() {
  const ctx = await getAuthContext()
  return listProcedureTypes(ctx.tenantId)
}

// ─── Get Previous Diagram Points (for ghost overlay) ────────────────

export async function getPreviousDiagramPointsAction(
  patientId: string,
  excludeProcedureId?: string
) {
  const ctx = await getAuthContext()
  const points = await getPreviousDiagramPoints(ctx.tenantId, patientId, excludeProcedureId)
  return { success: true, data: points }
}

// ─── Check Consent Status ───────────────────────────────────────────

export async function checkConsentStatusAction(
  patientId: string,
  consentType: string
) {
  const ctx = await getAuthContext()
  const consent = await getLatestConsentForPatientType(ctx.tenantId, patientId, consentType)
  return { success: true, data: consent }
}
