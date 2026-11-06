import { NextResponse } from 'next/server'
import { requireWrite } from '@/lib/write-access'
import { createTransfer } from '@/db/queries/financial-accounts'
import { transferSchema } from '@/validations/financial-accounts'
import { handleApiError } from '@/lib/api-error'
import { BusinessError } from '@/lib/errors'
import { ACCOUNT_MANAGER_ROLES } from '@/lib/financial/account-roles'

export async function POST(request: Request) {
  try {
    const { ctx, blocked } = await requireWrite(...ACCOUNT_MANAGER_ROLES)
    if (blocked) return blocked

    const parsed = transferSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Dados inválidos', fieldErrors: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    const result = await createTransfer(ctx.tenantId, ctx.userId, parsed.data)
    return NextResponse.json({ success: true, data: result })
  } catch (error) {
    if (error instanceof BusinessError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 409 })
    }
    return handleApiError(error, request)
  }
}
