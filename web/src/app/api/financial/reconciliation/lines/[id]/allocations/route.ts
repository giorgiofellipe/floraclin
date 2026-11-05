import { requireWrite } from '@/lib/write-access'
import { ACCOUNT_MANAGER_ROLES } from '@/lib/financial/account-roles'
import { allocateStatementLine, undoStatementLineMatch } from '@/db/queries/bank-reconciliation'
import { readJson, reconciliationRoute } from '@/lib/financial/reconciliation-route'
import { BusinessError } from '@/lib/errors'
import { allocateSchema, undoMatchSchema } from '@/validations/bank-reconciliation'

type RouteContext = { params: Promise<{ id: string }> }

/** Matches the line to ledger movements with explicit amounts in cents. */
export async function POST(request: Request, { params }: RouteContext) {
  return reconciliationRoute(request, () => requireWrite(...ACCOUNT_MANAGER_ROLES), async (ctx) => {
    const { id } = await params
    const body = await readJson(request, allocateSchema)
    return allocateStatementLine(ctx.tenantId, ctx.userId, id, body.allocations)
  })
}

/** Undo: unlinks the allocations (all, or the one in ?allocationId). Payments and movements are untouched. */
export async function DELETE(request: Request, { params }: RouteContext) {
  return reconciliationRoute(request, () => requireWrite(...ACCOUNT_MANAGER_ROLES), async (ctx) => {
    const { id } = await params
    const parsed = undoMatchSchema.safeParse({
      allocationId: new URL(request.url).searchParams.get('allocationId') ?? undefined,
    })
    if (!parsed.success) throw new BusinessError('INVALID_BODY', 'Conciliação inválida')
    return undoStatementLineMatch(ctx.tenantId, ctx.userId, { lineId: id, allocationId: parsed.data.allocationId })
  })
}
