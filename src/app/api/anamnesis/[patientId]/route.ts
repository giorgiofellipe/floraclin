import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { createAuditLog } from '@/lib/audit'
import { getAnamnesis, upsertAnamnesis, StaleDataError } from '@/db/queries/anamnesis'
import { anamnesisSchema } from '@/validations/anamnesis'

export async function GET(
  _request: Request,
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
    const msg = error instanceof Error ? error.message : ''
    if (msg.includes('Forbidden')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (msg.includes('NEXT_REDIRECT') || msg.includes('redirect')) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    console.error('API error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ patientId: string }> }
) {
  try {
    const ctx = await getAuthContext()
    if (!['owner', 'practitioner'].includes(ctx.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

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
    const msg = error instanceof Error ? error.message : ''
    if (msg.includes('Forbidden')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (msg.includes('NEXT_REDIRECT') || msg.includes('redirect')) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    console.error('API error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
