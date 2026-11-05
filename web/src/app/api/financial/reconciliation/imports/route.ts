import { requireWrite } from '@/lib/write-access'
import { ACCOUNT_MANAGER_ROLES } from '@/lib/financial/account-roles'
import { commitStatementImport, listStatementImports } from '@/db/queries/bank-reconciliation'
import { readOfxUpload, reconciliationRoute } from '@/lib/financial/reconciliation-route'
import { BusinessError } from '@/lib/errors'
import { importFormSchema } from '@/validations/bank-reconciliation'

export async function GET(request: Request) {
  return reconciliationRoute(request, 'read', async (ctx) => {
    const accountId = importFormSchema.safeParse({ accountId: new URL(request.url).searchParams.get('accountId') })
    if (!accountId.success) throw new BusinessError('INVALID_BODY', 'Conta inválida')
    return listStatementImports(ctx.tenantId, accountId.data.accountId)
  })
}

export async function POST(request: Request) {
  return reconciliationRoute(request, () => requireWrite(...ACCOUNT_MANAGER_ROLES), async (ctx) => {
    const upload = await readOfxUpload(request)
    return commitStatementImport(ctx.tenantId, ctx.userId, upload)
  })
}
