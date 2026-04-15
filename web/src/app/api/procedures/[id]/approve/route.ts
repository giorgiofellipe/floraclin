import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { createAuditLog } from '@/lib/audit'
import { withTransaction } from '@/lib/tenant'
import {
  getProcedure,
  listProcedureTypes,
  approveProcedure,
  getConsentAcceptancesForProcedure,
} from '@/db/queries/procedures'
import { getFaceDiagram } from '@/db/queries/face-diagrams'
import { createFinancialEntry } from '@/db/queries/financial'

const CATEGORY_TO_CONSENT: Record<string, string> = {
  toxina_botulinica: 'botox',
  botox: 'botox',
  preenchimento: 'filler',
  filler: 'filler',
  bioestimulador: 'biostimulator',
  biostimulator: 'biostimulator',
}

const CONSENT_TYPE_LABELS: Record<string, string> = {
  general: 'Termo Geral',
  botox: 'Termo de Toxina Botulínica',
  filler: 'Termo de Preenchimento',
  biostimulator: 'Termo de Bioestimulador',
  service_contract: 'Contrato de Serviço',
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await getAuthContext()
    if (!['owner', 'practitioner'].includes(ctx.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { id: procedureId } = await params
    const procedure = await getProcedure(ctx.tenantId, procedureId)
    if (!procedure) {
      return NextResponse.json({ error: 'Procedimento não encontrado' }, { status: 404 })
    }

    if (procedure.status !== 'planned') {
      return NextResponse.json({ error: 'Apenas procedimentos planejados podem ser aprovados' }, { status: 400 })
    }

    const requiredConsentTypes = new Set<string>(['general', 'service_contract'])
    const primaryConsentType = CATEGORY_TO_CONSENT[procedure.procedureTypeCategory?.toLowerCase()]
    if (primaryConsentType) requiredConsentTypes.add(primaryConsentType)

    const additionalTypeIds = (procedure.additionalTypeIds ?? []) as string[]
    if (additionalTypeIds.length > 0) {
      const allTypes = await listProcedureTypes(ctx.tenantId)
      for (const typeId of additionalTypeIds) {
        const pType = allTypes.find((t) => t.id === typeId)
        if (pType) {
          const consentType = CATEGORY_TO_CONSENT[pType.category?.toLowerCase()]
          if (consentType) requiredConsentTypes.add(consentType)
        }
      }
    }

    const acceptances = await getConsentAcceptancesForProcedure(ctx.tenantId, procedureId)
    const signedTypes = new Set(acceptances.map((a) => a.templateType))
    const missingTypes: string[] = []
    for (const requiredType of requiredConsentTypes) {
      if (!signedTypes.has(requiredType)) missingTypes.push(requiredType)
    }

    if (missingTypes.length > 0) {
      const missingLabels = missingTypes.map((t) => CONSENT_TYPE_LABELS[t] ?? t).join(', ')
      return NextResponse.json({ error: `Termos pendentes de assinatura: ${missingLabels}` }, { status: 400 })
    }

    const diagrams = await getFaceDiagram(ctx.tenantId, procedureId)

    const result = await withTransaction(async (tx) => {
      const updated = await approveProcedure(ctx.tenantId, procedureId, diagrams, tx)
      if (!updated) throw new Error('Falha ao aprovar procedimento')

      const financialPlan = procedure.financialPlan as {
        totalAmount: number
        installmentCount: number
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
      changes: { status: { old: 'planned', new: 'approved' } },
    })

    return NextResponse.json({ success: true, data: result })
  } catch (error) {
    const msg = error instanceof Error ? error.message : ''
    if (msg.includes('Forbidden')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (msg.includes('NEXT_REDIRECT') || msg.includes('redirect')) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    console.error('API error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
