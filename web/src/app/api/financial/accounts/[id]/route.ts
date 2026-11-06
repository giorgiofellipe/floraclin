import { NextResponse } from 'next/server'
import { requireWrite } from '@/lib/write-access'
import { setFinancialAccountArchived, updateFinancialAccount } from '@/db/queries/financial-accounts'
import {
  archiveFinancialAccountSchema,
  updateFinancialAccountSchema,
} from '@/validations/financial-accounts'
import { handleApiError } from '@/lib/api-error'
import { BusinessError } from '@/lib/errors'
import { ACCOUNT_MANAGER_ROLES } from '@/lib/financial/account-roles'

type RouteContext = { params: Promise<{ id: string }> }

function notFound(error: unknown) {
  if (error instanceof BusinessError && error.code === 'FINANCIAL_ACCOUNT_NOT_FOUND') {
    return NextResponse.json({ error: error.message }, { status: 404 })
  }
  return null
}

function invalid(error: { flatten: () => { fieldErrors: unknown } }) {
  return NextResponse.json(
    { error: 'Dados inválidos', fieldErrors: error.flatten().fieldErrors },
    { status: 400 },
  )
}

export async function PATCH(request: Request, { params }: RouteContext) {
  try {
    const { ctx, blocked } = await requireWrite(...ACCOUNT_MANAGER_ROLES)
    if (blocked) return blocked
    const { id } = await params

    const parsed = updateFinancialAccountSchema.safeParse(await request.json())
    if (!parsed.success) return invalid(parsed.error)

    const account = await updateFinancialAccount(ctx.tenantId, ctx.userId, id, parsed.data)
    return NextResponse.json({ success: true, data: account })
  } catch (error) {
    return notFound(error) ?? handleApiError(error, request)
  }
}

/** Archive or restore. Archived accounts keep their history and references. */
export async function PUT(request: Request, { params }: RouteContext) {
  try {
    const { ctx, blocked } = await requireWrite(...ACCOUNT_MANAGER_ROLES)
    if (blocked) return blocked
    const { id } = await params

    const parsed = archiveFinancialAccountSchema.safeParse(await request.json())
    if (!parsed.success) return invalid(parsed.error)

    const account = await setFinancialAccountArchived(ctx.tenantId, ctx.userId, id, parsed.data.archived)
    return NextResponse.json({ success: true, data: account })
  } catch (error) {
    return notFound(error) ?? handleApiError(error, request)
  }
}
