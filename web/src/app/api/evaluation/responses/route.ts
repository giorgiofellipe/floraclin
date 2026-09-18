import { NextResponse } from 'next/server'
import { requireWrite } from '@/lib/write-access'
import { createAuditLog } from '@/lib/audit'
import { saveEvaluationResponse } from '@/db/queries/evaluation-responses'
import { handleApiError } from '@/lib/api-error'

export async function POST(request: Request) {
  try {
    const { ctx, blocked } = await requireWrite('owner', 'practitioner')
    if (blocked) return blocked

    const body = await request.json()
    const response = await saveEvaluationResponse(ctx.tenantId, body)

    await createAuditLog({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'update',
      entityType: 'evaluation_response',
      entityId: response.id,
      changes: {
        templateId: { old: null, new: body.templateId },
        procedureRecordId: { old: null, new: body.procedureRecordId },
      },
    })

    return NextResponse.json({ success: true, data: response })
  } catch (error) {
    return handleApiError(error, request)
  }
}
