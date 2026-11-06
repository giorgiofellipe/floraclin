import { NextResponse } from 'next/server'
import { listNfseDocuments } from '@/db/queries/nfse'
import { handleApiError } from '@/lib/api-error'
import { requireRole } from '@/lib/auth'
import { nfseDocumentsFilterSchema } from '@/validations/nfse'

export async function GET(request: Request) {
  try {
    const ctx = await requireRole('owner', 'receptionist', 'financial')
    const params = Object.fromEntries(new URL(request.url).searchParams)
    const parsed = nfseDocumentsFilterSchema.safeParse(params)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Filtros inválidos' }, { status: 400 })
    }
    return NextResponse.json(await listNfseDocuments(ctx.tenantId, parsed.data))
  } catch (error) {
    return handleApiError(error, request)
  }
}
