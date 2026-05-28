import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { createAuditLog } from '@/lib/audit'
import { startPackageSession } from '@/lib/packages'
import { startPackageSessionSchema } from '@/validations/package'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; lineId: string }> },
) {
  try {
    const ctx = await getAuthContext()
    if (!['owner', 'practitioner'].includes(ctx.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { id, lineId } = await params

    let parsedInput = { allowExpiredOverride: false as boolean | undefined }
    const text = await request.text()
    if (text) {
      try {
        const body = JSON.parse(text)
        const parsed = startPackageSessionSchema.safeParse(body)
        if (parsed.success) parsedInput = { allowExpiredOverride: parsed.data.allowExpiredOverride }
      } catch {
        // ignore — empty/invalid JSON body is treated as no overrides.
      }
    }

    const result = await startPackageSession({
      tenantId: ctx.tenantId,
      practitionerId: ctx.userId,
      patientPackageId: id,
      patientPackageLineId: lineId,
      allowExpiredOverride: parsedInput.allowExpiredOverride,
    })

    await createAuditLog({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'create',
      entityType: 'procedure_record',
      entityId: result.procedureRecordId,
      changes: {
        source: { old: null, new: 'package_session' },
        patientPackageId: { old: null, new: id },
        patientPackageLineId: { old: null, new: lineId },
      },
    })

    return NextResponse.json({ success: true, data: result })
  } catch (error) {
    const msg = error instanceof Error ? error.message : ''
    if (msg.includes('Forbidden')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (msg.includes('NEXT_REDIRECT') || msg.includes('redirect')) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (
      msg.includes('não encontrado') ||
      msg.includes('não pertence') ||
      msg.includes('cancelado') ||
      msg.includes('expirado') ||
      msg.includes('esgotadas') ||
      msg.includes('concluído')
    ) {
      return NextResponse.json({ error: msg }, { status: 400 })
    }
    console.error('API error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
