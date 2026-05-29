import { NextResponse, type NextRequest } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { getClinicalDocumentWithContext } from '@/db/queries/clinical-documents'

/**
 * Returns the full clinical document (including body + patient/tenant context)
 * for the history preview modal. Tenant-scoped via `getClinicalDocumentWithContext`.
 */
export async function GET(
  _request: NextRequest,
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
    const msg = error instanceof Error ? error.message : ''
    if (msg.includes('Forbidden'))
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (msg.includes('NEXT_REDIRECT') || msg.includes('redirect'))
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    console.error('Clinical document GET error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
