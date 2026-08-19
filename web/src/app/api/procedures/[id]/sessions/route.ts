import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { executeSession } from '@/lib/session-execute'
import { createSessionWireSchema } from '@/validations/procedure-session'
import { BusinessError } from '@/lib/errors'
import type { DiagramViewType } from '@/types'
import type { ProductApplicationItem } from '@/validations/procedure'
import { handleApiError } from '@/lib/api-error'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireRole('owner', 'practitioner')
    const recordId = (await params).id
    const body = createSessionWireSchema.parse(await request.json())

    const result = await executeSession({
      tenantId: ctx.tenantId,
      procedureRecordId: recordId,
      executedBy: ctx.userId,
      performedAt: new Date(body.performedAt),
      technique: body.technique || null,
      clinicalResponse: body.clinicalResponse || null,
      adverseEffects: body.adverseEffects || null,
      notes: body.notes || null,
      followUpDate: body.followUpDate ?? null,
      nextSessionObjectives: body.nextSessionObjectives || null,
      productApplications: body.productApplications.map((p) => ({
        ...p,
        quantityUnit: p.quantityUnit as 'U' | 'mL',
        expirationDate: p.expirationDate ?? undefined,
      })) as ProductApplicationItem[],
      diagrams: body.diagramPoints?.map((d) => ({
        viewType: d.viewType as DiagramViewType,
        points: d.points,
      })),
      photoAssetIds: body.photoAssetIds,
    })

    return NextResponse.json({ success: true, data: result })
  } catch (error) {
    if (error instanceof BusinessError) {
      // P2: map business errors to 409 with stable code so the UI can refetch picker state
      return NextResponse.json({ success: false, code: error.code, error: error.message }, { status: 409 })
    }
    return handleApiError(error, request, { body: { success: false, error: 'Erro ao salvar sessão' } })
  }
}
