import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { requireWrite } from '@/lib/write-access'
import { createFinancialAccount, listFinancialAccounts } from '@/db/queries/financial-accounts'
import { createFinancialAccountSchema } from '@/validations/financial-accounts'
import { handleApiError } from '@/lib/api-error'
import { ACCOUNT_MANAGER_ROLES, canManageAccounts } from '@/lib/financial/account-roles'

export async function GET(request: Request) {
  try {
    const ctx = await getAuthContext()
    // Same readers as the ledger. A receptionist sees the accounts to pick
    // one when recording a payment, not their balances.
    if (!['owner', 'financial', 'receptionist'].includes(ctx.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    const canManage = canManageAccounts(ctx.role)

    const includeArchived = new URL(request.url).searchParams.get('includeArchived') === 'true'
    const accounts = await listFinancialAccounts(ctx.tenantId, { includeArchived })

    return NextResponse.json({
      data: canManage ? accounts : accounts.map(({ balance: _balance, openingBalance: _opening, ...rest }) => rest),
      canManage,
    })
  } catch (error) {
    return handleApiError(error, request)
  }
}

export async function POST(request: Request) {
  try {
    const { ctx, blocked } = await requireWrite(...ACCOUNT_MANAGER_ROLES)
    if (blocked) return blocked

    const parsed = createFinancialAccountSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Dados inválidos', fieldErrors: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    const account = await createFinancialAccount(ctx.tenantId, ctx.userId, parsed.data)
    return NextResponse.json({ success: true, data: account })
  } catch (error) {
    return handleApiError(error, request)
  }
}
