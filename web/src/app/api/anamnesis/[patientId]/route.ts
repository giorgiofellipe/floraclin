import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { requireWrite } from '@/lib/write-access'
import { createAuditLog } from '@/lib/audit'
import { getAnamnesis, upsertAnamnesis, StaleDataError } from '@/db/queries/anamnesis'
import { anamnesisSchema } from '@/validations/anamnesis'
import { handleApiError } from '@/lib/api-error'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ patientId: string }> }
) {
  try {
    const ctx = await getAuthContext()
    if (!['owner', 'practitioner'].includes(ctx.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { patientId } = await params
    const anamnesis = await getAnamnesis(ctx.tenantId, patientId)
    return NextResponse.json(anamnesis)
  } catch (error) {
    return handleApiError(error, request)
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ patientId: string }> }
) {
  try {
    const { ctx, blocked } = await requireWrite('owner', 'practitioner')
    if (blocked) return blocked

    const { patientId } = await params
    const body = await request.json()
    const { formData, expectedUpdatedAt } = body

    const parsed = anamnesisSchema.safeParse(formData)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Dados inválidos: ' + parsed.error.issues.map((i: { message: string }) => i.message).join(', ') },
        { status: 400 }
      )
    }

    const existing = await getAnamnesis(ctx.tenantId, patientId)
    const isCreate = !existing

    const result = await upsertAnamnesis(
      ctx.tenantId,
      patientId,
      ctx.userId,
      parsed.data,
      expectedUpdatedAt ? new Date(expectedUpdatedAt) : undefined
    )

    await createAuditLog({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: isCreate ? 'create' : 'update',
      entityType: 'anamnesis',
      entityId: result.id,
      changes: isCreate ? { created: { old: null, new: 'anamnesis' } } : undefined,
    })

    return NextResponse.json({
      success: true,
      data: {
        id: result.id,
        updatedAt: result.updatedAt,
        updatedBy: result.updatedBy,
      },
    })
  } catch (error) {
    if (error instanceof StaleDataError) {
      return NextResponse.json({ error: error.message }, { status: 409 })
    }
    return handleApiError(error, request)
  }
}
