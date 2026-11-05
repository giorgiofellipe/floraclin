import { previewStatementImport } from '@/db/queries/bank-reconciliation'
import { readOfxUpload, reconciliationRoute } from '@/lib/financial/reconciliation-route'

/** Validates and summarises an upload without writing anything. */
export async function POST(request: Request) {
  return reconciliationRoute(request, 'read', async (ctx) => {
    const upload = await readOfxUpload(request)
    return previewStatementImport(ctx.tenantId, upload.accountId, upload.parsed)
  })
}
