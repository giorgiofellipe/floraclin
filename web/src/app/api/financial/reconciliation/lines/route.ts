import { listStatementLines } from '@/db/queries/bank-reconciliation'
import { reconciliationRoute } from '@/lib/financial/reconciliation-route'
import { BusinessError } from '@/lib/errors'
import { statementLineFilterSchema } from '@/validations/bank-reconciliation'

export async function GET(request: Request) {
  return reconciliationRoute(request, 'read', async (ctx) => {
    const params = new URL(request.url).searchParams
    const parsed = statementLineFilterSchema.safeParse({
      accountId: params.get('accountId'),
      status: params.get('status') ?? undefined,
      offset: params.get('offset') ?? undefined,
    })
    if (!parsed.success) throw new BusinessError('INVALID_BODY', parsed.error.issues[0]?.message ?? 'Filtro inválido')
    return listStatementLines(ctx.tenantId, parsed.data)
  })
}
