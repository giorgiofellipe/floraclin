import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { getFinancialEntry } from '@/db/queries/financial'

export async function GET(
  _request: Request,
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
    const msg = error instanceof Error ? error.message : ''
    if (msg.includes('Forbidden')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (msg.includes('NEXT_REDIRECT') || msg.includes('redirect')) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    console.error('API error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
