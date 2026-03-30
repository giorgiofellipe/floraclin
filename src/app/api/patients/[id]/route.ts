import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { getPatient } from '@/db/queries/patients'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await getAuthContext()
    const { id } = await params
    const data = await getPatient(ctx.tenantId, id)

    if (!data) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    return NextResponse.json(data)
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
}
