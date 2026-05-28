import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { createAuditLog } from '@/lib/audit'
import { cancelPackage } from '@/lib/packages'
import { cancelPackageSchema } from '@/validations/package'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await getAuthContext()
    if (!['owner', 'practitioner', 'financial'].includes(ctx.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { id } = await params
    const body = await request.json()
    const parsed = cancelPackageSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Dados inválidos', fieldErrors: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    const cancelled = await cancelPackage({
      tenantId: ctx.tenantId,
      patientPackageId: id,
      reason: parsed.data.reason,
    })

    if (!cancelled) {
      return NextResponse.json(
        { error: 'Pacote não pode ser cancelado (já concluído ou cancelado)' },
        { status: 400 },
      )
    }

    await createAuditLog({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'update',
      entityType: 'patient_package',
      entityId: id,
      changes: {
        status: { old: 'active', new: 'cancelled' },
        reason: { old: null, new: parsed.data.reason },
      },
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    const msg = error instanceof Error ? error.message : ''
    if (msg.includes('Forbidden')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (msg.includes('NEXT_REDIRECT') || msg.includes('redirect')) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (msg.includes('não encontrado')) return NextResponse.json({ error: msg }, { status: 404 })
    console.error('API error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
