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
  getLatestNonExecutedProcedure,
  approveProcedure,
  executeProcedure,
  cancelProcedure,
  getConsentAcceptancesForProcedure,
} from '@/db/queries/procedures'
import { createFinancialEntry } from '@/db/queries/financial'
import { financialEntries, installments } from '@/db/schema'
import { eq, and, isNull } from 'drizzle-orm'
import { db } from '@/db/client'
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
    financialPlan?: {
      totalAmount: number
      installmentCount: number
      paymentMethod?: 'pix' | 'credit_card' | 'debit_card' | 'cash' | 'transfer'
      notes?: string
    }
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
    financialPlan: formData.financialPlan,
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
    financialPlan?: {
      totalAmount: number
      installmentCount: number
      paymentMethod?: 'pix' | 'credit_card' | 'debit_card' | 'cash' | 'transfer'
      notes?: string
    }
  }
): Promise<ProcedureActionResult> {
  const ctx = await requireRole('owner', 'practitioner')

  // Defense-in-depth: strip status from payload to prevent lifecycle bypass
  const { status: _stripStatus, ...safeFormData } = formData as Record<string, unknown>
  const parsed = updateProcedureSchema.safeParse({ id, ...safeFormData })
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
  const ctx = await requireRole('owner', 'practitioner')

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

// ─── Get Latest Non-Executed Procedure ─────────────────────────────

export async function getLatestNonExecutedProcedureAction(patientId: string) {
  const ctx = await getAuthContext()
  return getLatestNonExecutedProcedure(ctx.tenantId, patientId).catch(() => null)
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

// ─── Approve Procedure ─────────────────────────────────────────────

export async function approveProcedureAction(
  procedureId: string
): Promise<ProcedureActionResult> {
  const ctx = await requireRole('owner', 'practitioner')

  try {
    const procedure = await getProcedure(ctx.tenantId, procedureId)
    if (!procedure) {
      return { success: false, error: 'Procedimento não encontrado' }
    }

    if (procedure.status !== 'planned') {
      return { success: false, error: 'Apenas procedimentos planejados podem ser aprovados' }
    }

    // ─── Determine all required consent types from procedure categories ───
    const CATEGORY_TO_CONSENT: Record<string, string> = {
      toxina_botulinica: 'botox',
      botox: 'botox',
      preenchimento: 'filler',
      filler: 'filler',
      bioestimulador: 'biostimulator',
      biostimulator: 'biostimulator',
    }

    const requiredConsentTypes = new Set<string>()
    requiredConsentTypes.add('general') // always required

    // Map primary procedure type category
    const primaryConsentType = CATEGORY_TO_CONSENT[procedure.procedureTypeCategory?.toLowerCase()]
    if (primaryConsentType) {
      requiredConsentTypes.add(primaryConsentType)
    }

    // Map additional procedure type categories
    const additionalTypeIds = (procedure.additionalTypeIds ?? []) as string[]
    if (additionalTypeIds.length > 0) {
      const allTypes = await listProcedureTypes(ctx.tenantId)
      for (const typeId of additionalTypeIds) {
        const pType = allTypes.find((t) => t.id === typeId)
        if (pType) {
          const consentType = CATEGORY_TO_CONSENT[pType.category?.toLowerCase()]
          if (consentType) {
            requiredConsentTypes.add(consentType)
          }
        }
      }
    }

    // Also require service_contract
    requiredConsentTypes.add('service_contract')

    // Verify each required consent type has an acceptance for THIS procedure
    const acceptances = await getConsentAcceptancesForProcedure(ctx.tenantId, procedureId)
    const signedTypes = new Set(acceptances.map((a) => a.templateType))

    const missingTypes: string[] = []
    for (const requiredType of requiredConsentTypes) {
      if (!signedTypes.has(requiredType)) {
        missingTypes.push(requiredType)
      }
    }

    if (missingTypes.length > 0) {
      const CONSENT_TYPE_LABELS: Record<string, string> = {
        general: 'Termo Geral',
        botox: 'Termo de Toxina Botulínica',
        filler: 'Termo de Preenchimento',
        biostimulator: 'Termo de Bioestimulador',
        service_contract: 'Contrato de Serviço',
      }
      const missingLabels = missingTypes.map((t) => CONSENT_TYPE_LABELS[t] ?? t).join(', ')
      return { success: false, error: `Termos pendentes de assinatura: ${missingLabels}` }
    }

    // Get diagram points as planned snapshot
    const diagrams = await getFaceDiagram(ctx.tenantId, procedureId)
    const plannedSnapshot = diagrams

    const result = await withTransaction(async (tx) => {
      // 1. Set status to approved with snapshot
      const updated = await approveProcedure(
        ctx.tenantId,
        procedureId,
        plannedSnapshot,
        tx
      )

      if (!updated) {
        throw new Error('Falha ao aprovar procedimento')
      }

      // 2. Create financial entry from financialPlan if it exists
      const financialPlan = procedure.financialPlan as {
        totalAmount: number
        installmentCount: number
        paymentMethod?: string
        notes?: string
      } | null

      if (financialPlan) {
        await createFinancialEntry(ctx.tenantId, ctx.userId, {
          patientId: procedure.patientId,
          procedureRecordId: procedureId,
          description: `Procedimento: ${procedure.procedureTypeName}`,
          totalAmount: financialPlan.totalAmount,
          installmentCount: financialPlan.installmentCount,
          notes: financialPlan.notes,
        }, tx)
      }

      return updated
    })

    await createAuditLog({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'update',
      entityType: 'procedure_record',
      entityId: procedureId,
      changes: {
        status: { old: 'planned', new: 'approved' },
      },
    })

    return { success: true, data: result }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Erro ao aprovar procedimento',
    }
  }
}

// ─── Execute Procedure ─────────────────────────────────────────────

export async function executeProcedureAction(
  procedureId: string,
  formData: {
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

  try {
    const procedure = await getProcedure(ctx.tenantId, procedureId)
    if (!procedure) {
      return { success: false, error: 'Procedimento não encontrado' }
    }

    if (procedure.status !== 'approved') {
      return { success: false, error: 'Apenas procedimentos aprovados podem ser executados' }
    }

    const result = await withTransaction(async (tx) => {
      // 1. Update procedure to executed status with clinical data
      const updated = await executeProcedure(
        ctx.tenantId,
        procedureId,
        {
          technique: formData.technique,
          clinicalResponse: formData.clinicalResponse,
          adverseEffects: formData.adverseEffects,
          notes: formData.notes,
          followUpDate: formData.followUpDate,
          nextSessionObjectives: formData.nextSessionObjectives,
        },
        tx
      )

      if (!updated) {
        throw new Error('Falha ao executar procedimento')
      }

      // 2. Save updated face diagrams (real quantities)
      if (formData.diagrams && formData.diagrams.length > 0) {
        for (const diagram of formData.diagrams) {
          await saveFaceDiagram(
            ctx.tenantId,
            procedureId,
            diagram.viewType,
            diagram.points,
            tx
          )
        }
      }

      // 3. Save product applications (batch/lot numbers)
      if (formData.productApplications !== undefined) {
        await saveProductApplications(
          ctx.tenantId,
          procedureId,
          formData.productApplications,
          tx
        )
      }

      return updated
    })

    await createAuditLog({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'update',
      entityType: 'procedure_record',
      entityId: procedureId,
      changes: {
        status: { old: 'approved', new: 'executed' },
      },
    })

    return { success: true, data: result }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Erro ao executar procedimento',
    }
  }
}

// ─── Cancel Procedure ──────────────────────────────────────────────

export async function cancelProcedureAction(
  procedureId: string,
  reason: string
): Promise<ProcedureActionResult> {
  const ctx = await requireRole('owner', 'practitioner')

  if (!reason || reason.trim().length === 0) {
    return { success: false, error: 'Motivo do cancelamento é obrigatório' }
  }

  try {
    const procedure = await getProcedure(ctx.tenantId, procedureId)
    if (!procedure) {
      return { success: false, error: 'Procedimento não encontrado' }
    }

    if (procedure.status !== 'planned' && procedure.status !== 'approved') {
      return { success: false, error: 'Apenas procedimentos planejados ou aprovados podem ser cancelados' }
    }

    const result = await withTransaction(async (tx) => {
      // 1. Cancel the procedure
      const updated = await cancelProcedure(
        ctx.tenantId,
        procedureId,
        reason.trim(),
        tx
      )

      if (!updated) {
        throw new Error('Falha ao cancelar procedimento')
      }

      // 2. If approved, cancel associated financial entry and its installments
      if (procedure.status === 'approved') {
        const cancelledEntries = await (tx as unknown as typeof db)
          .update(financialEntries)
          .set({
            status: 'cancelled',
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(financialEntries.procedureRecordId, procedureId),
              eq(financialEntries.tenantId, ctx.tenantId),
              isNull(financialEntries.deletedAt)
            )
          )
          .returning({ id: financialEntries.id })

        // Cancel all installments associated with the cancelled financial entries
        for (const entry of cancelledEntries) {
          await (tx as unknown as typeof db)
            .update(installments)
            .set({
              status: 'cancelled',
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(installments.financialEntryId, entry.id),
                eq(installments.tenantId, ctx.tenantId)
              )
            )
        }
      }

      return updated
    })

    await createAuditLog({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'update',
      entityType: 'procedure_record',
      entityId: procedureId,
      changes: {
        status: { old: procedure.status, new: 'cancelled' },
        cancellationReason: { old: null, new: reason.trim() },
      },
    })

    return { success: true, data: result }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Erro ao cancelar procedimento',
    }
  }
}
