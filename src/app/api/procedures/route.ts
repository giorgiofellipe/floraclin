import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { listProcedures } from '@/db/queries/procedures'

export async function GET(request: Request) {
  try {
    const ctx = await getAuthContext()
    const { searchParams } = new URL(request.url)

    const patientId = searchParams.get('patientId') ?? ''

    if (!patientId) {
      return NextResponse.json(
        { error: 'patientId is required' },
        { status: 400 }
      )
    }

    const data = await listProcedures(ctx.tenantId, patientId)
    return NextResponse.json(data)
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
}
