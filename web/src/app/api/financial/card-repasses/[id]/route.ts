import { NextResponse } from 'next/server'
import { requireWrite } from '@/lib/write-access'
import { adjustCardRepasse } from '@/db/queries/card-payments'
import { adjustRepasseSchema } from '@/validations/card-repasses'
import { handleApiError } from '@/lib/api-error'
import { BusinessError } from '@/lib/errors'

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { ctx, blocked } = await requireWrite('owner', 'financial')
    if (blocked) return blocked

    const { id } = await params
    const parsed = adjustRepasseSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Dados inválidos', fieldErrors: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    await adjustCardRepasse(ctx.tenantId, ctx.userId, id, parsed.data)
    return NextResponse.json({ success: true })
  } catch (error) {
    if (error instanceof BusinessError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 409 })
    }
    return handleApiError(error, request)
  }
}
