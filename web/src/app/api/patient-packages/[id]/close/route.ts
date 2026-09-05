import { NextResponse } from 'next/server'
import { requireWrite } from '@/lib/write-access'
import { closePackage } from '@/lib/packages'
import { closePackageSchema } from '@/validations/encerrar-pacote'
import { handleApiError } from '@/lib/api-error'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { ctx, blocked } = await requireWrite('owner')
    if (blocked) return blocked
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
    return handleApiError(error, request, { body: { success: false, error: 'Erro ao encerrar pacote' } })
  }
}
