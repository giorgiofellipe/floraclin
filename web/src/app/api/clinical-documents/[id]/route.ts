import { NextResponse, type NextRequest } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { getClinicalDocumentWithContext } from '@/db/queries/clinical-documents'
import { handleApiError } from '@/lib/api-error'

/**
 * Returns the full clinical document (including body + patient/tenant context)
 * for the history preview modal. Tenant-scoped via `getClinicalDocumentWithContext`.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await getAuthContext()
    const { id } = await params
    const doc = await getClinicalDocumentWithContext(ctx.tenantId, id)
    if (!doc) {
      return NextResponse.json({ error: 'Documento não encontrado' }, { status: 404 })
    }
    return NextResponse.json({ data: doc })
  } catch (error) {
    return handleApiError(error, request)
  }
}
