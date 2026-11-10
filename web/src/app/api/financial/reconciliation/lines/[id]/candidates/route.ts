import { findMatchCandidateResult } from '@/db/queries/bank-reconciliation'
import { reconciliationRoute } from '@/lib/financial/reconciliation-route'
import { BusinessError } from '@/lib/errors'
import { candidatesQuerySchema } from '@/validations/bank-reconciliation'

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(request: Request, { params }: RouteContext) {
  return reconciliationRoute(request, 'read', async (ctx) => {
    const { id } = await params
    const query = new URL(request.url).searchParams
    const parsed = candidatesQuerySchema.safeParse({ search: query.get('search') ?? undefined })
    if (!parsed.success) throw new BusinessError('INVALID_BODY', 'Filtro inválido')
    return findMatchCandidateResult(ctx.tenantId, id, parsed.data)
  })
}
