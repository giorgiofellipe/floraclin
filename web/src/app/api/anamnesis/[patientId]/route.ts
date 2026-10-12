import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { requireWrite } from '@/lib/write-access'
import { createAuditLog } from '@/lib/audit'
import { getAnamnesis, upsertAnamnesis, StaleDataError } from '@/db/queries/anamnesis'
import { getCurrentAnamnesisTemplate } from '@/db/queries/anamnesis-templates'
import { anamnesisSaveBodySchema } from '@/lib/anamnesis/schemas'
import { prepareAnamnesisSave } from '@/lib/anamnesis/prepare-save'
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
    const body = anamnesisSaveBodySchema.safeParse(await request.json())
    if (!body.success) return NextResponse.json({ error: 'Dados inválidos' }, { status: 400 })

    const [existing, current] = await Promise.all([
      getAnamnesis(ctx.tenantId, patientId),
      getCurrentAnamnesisTemplate(ctx.tenantId),
    ])
    const prepared = prepareAnamnesisSave({
      mode: body.data.applyCurrentTemplate ? 'staff_apply_current' : 'staff',
      existing,
      current,
      body: body.data,
    })
    if (!prepared.ok) {
      return NextResponse.json(
        prepared.status === 409 ? { error: prepared.error, code: prepared.code } : { error: prepared.error },
        { status: prepared.status },
      )
    }

    const isCreate = !existing
    const result = await upsertAnamnesis(
      ctx.tenantId,
      patientId,
      ctx.userId,
      prepared.write,
      body.data.expectedUpdatedAt ? new Date(body.data.expectedUpdatedAt) : undefined,
    )

    await createAuditLog({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: isCreate ? 'create' : 'update',
      entityType: 'anamnesis',
      entityId: result.id,
      changes: isCreate ? { created: { old: null, new: 'anamnesis' } } : undefined,
    })

    return NextResponse.json({ success: true, data: result })
  } catch (error) {
    if (error instanceof StaleDataError) {
      return NextResponse.json({ error: error.message, code: 'stale' }, { status: 409 })
    }
    return handleApiError(error, request)
  }
}
