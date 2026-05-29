import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { closePackage } from '@/lib/packages'
import { closePackageSchema } from '@/validations/encerrar-pacote'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireRole('owner')
    const packageId = (await params).id
    const body = closePackageSchema.parse(await request.json())

    await closePackage({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      packageId,
      closedReason: body.closedReason,
      closeNote: body.closeNote || null,
    })
    return NextResponse.json({ success: true })
  } catch (error) {
    const msg = error instanceof Error ? error.message : ''
    if (msg.includes('Forbidden')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (msg.includes('redirect') || msg.includes('NEXT_REDIRECT')) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    console.error('Close package error:', error)
    return NextResponse.json({ success: false, error: 'Erro ao encerrar pacote' }, { status: 500 })
  }
}
