import { requireWrite } from '@/lib/write-access'
import { ACCOUNT_MANAGER_ROLES } from '@/lib/financial/account-roles'
import { createExpenseFromStatementLine } from '@/db/queries/bank-reconciliation'
import { readJson, reconciliationRoute } from '@/lib/financial/reconciliation-route'
import { expenseFromLineSchema } from '@/validations/bank-reconciliation'

type RouteContext = { params: Promise<{ id: string }> }

/** Explicitly records a bank debit as a paid expense and matches it, atomically. */
export async function POST(request: Request, { params }: RouteContext) {
  return reconciliationRoute(request, () => requireWrite(...ACCOUNT_MANAGER_ROLES), async (ctx) => {
    const { id } = await params
    const body = await readJson(request, expenseFromLineSchema)
    return createExpenseFromStatementLine(ctx.tenantId, ctx.userId, id, body)
  })
}
