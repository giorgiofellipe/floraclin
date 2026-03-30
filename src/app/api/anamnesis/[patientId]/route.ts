import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { getAnamnesis } from '@/db/queries/anamnesis'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ patientId: string }> }
) {
  try {
    const ctx = await getAuthContext()
    const { patientId } = await params
    const data = await getAnamnesis(ctx.tenantId, patientId)
    return NextResponse.json(data)
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
}
