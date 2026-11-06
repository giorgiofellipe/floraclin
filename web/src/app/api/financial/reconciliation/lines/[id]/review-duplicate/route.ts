import { requireWrite } from '@/lib/write-access'
import { ACCOUNT_MANAGER_ROLES } from '@/lib/financial/account-roles'
import { confirmSuspectedLineIsDistinct } from '@/db/queries/bank-reconciliation'
import { reconciliationRoute } from '@/lib/financial/reconciliation-route'

type RouteContext = { params: Promise<{ id: string }> }

/** The user checked a suspected duplicate and keeps it as a genuine, separate line. */
export async function POST(request: Request, { params }: RouteContext) {
  return reconciliationRoute(request, () => requireWrite(...ACCOUNT_MANAGER_ROLES), async (ctx) => {
    const { id } = await params
    return confirmSuspectedLineIsDistinct(ctx.tenantId, ctx.userId, id)
  })
}
