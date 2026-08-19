import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { getFinancialEntry } from '@/db/queries/financial'
import { handleApiError } from '@/lib/api-error'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await getAuthContext()
    // Financial detail: owner + financial + receptionist + practitioner
    if (!['owner', 'financial', 'receptionist', 'practitioner'].includes(ctx.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { id } = await params
    const entry = await getFinancialEntry(ctx.tenantId, id)
    if (!entry) {
      return NextResponse.json({ error: 'Cobrança não encontrada' }, { status: 404 })
    }

    return NextResponse.json(entry)
  } catch (error) {
    return handleApiError(error, request)
  }
}
