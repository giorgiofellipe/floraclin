import { NextResponse } from 'next/server'
import { requireWrite } from '@/lib/write-access'
import { moveMovementsToAccount, previewMoveMovements } from '@/db/queries/financial-accounts'
import { moveMovementsSchema } from '@/validations/financial-accounts'
import { handleApiError } from '@/lib/api-error'
import { BusinessError } from '@/lib/errors'
import { ACCOUNT_MANAGER_ROLES } from '@/lib/financial/account-roles'

export async function POST(request: Request) {
  try {
    const { ctx, blocked } = await requireWrite(...ACCOUNT_MANAGER_ROLES)
    if (blocked) return blocked

    const parsed = moveMovementsSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? 'Dados inválidos', fieldErrors: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    const result = parsed.data.preview
      ? await previewMoveMovements(ctx.tenantId, parsed.data)
      : await moveMovementsToAccount(ctx.tenantId, ctx.userId, parsed.data)
    return NextResponse.json({ success: true, data: result })
  } catch (error) {
    if (error instanceof BusinessError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 409 })
    }
    return handleApiError(error, request)
  }
}
