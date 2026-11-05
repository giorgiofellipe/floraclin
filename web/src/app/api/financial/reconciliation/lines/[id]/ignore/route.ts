import { requireWrite } from '@/lib/write-access'
import { ACCOUNT_MANAGER_ROLES } from '@/lib/financial/account-roles'
import { ignoreStatementLine, unignoreStatementLine } from '@/db/queries/bank-reconciliation'
import { readJson, reconciliationRoute } from '@/lib/financial/reconciliation-route'
import { ignoreLineSchema } from '@/validations/bank-reconciliation'

type RouteContext = { params: Promise<{ id: string }> }

export async function POST(request: Request, { params }: RouteContext) {
  return reconciliationRoute(request, () => requireWrite(...ACCOUNT_MANAGER_ROLES), async (ctx) => {
    const { id } = await params
    const body = await readJson(request, ignoreLineSchema)
    return ignoreStatementLine(ctx.tenantId, ctx.userId, id, body.reason)
  })
}

export async function DELETE(request: Request, { params }: RouteContext) {
  return reconciliationRoute(request, () => requireWrite(...ACCOUNT_MANAGER_ROLES), async (ctx) => {
    const { id } = await params
    return unignoreStatementLine(ctx.tenantId, ctx.userId, id)
  })
}
