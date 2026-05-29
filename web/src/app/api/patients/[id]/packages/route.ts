import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { getPatientPackagesWithConsumption } from '@/db/queries/packages'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await getAuthContext()
    const { id: patientId } = await params

    const packages = await getPatientPackagesWithConsumption(ctx.tenantId, patientId)
    return NextResponse.json(packages)
  } catch (error) {
    const msg = error instanceof Error ? error.message : ''
    if (msg.includes('Forbidden')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (msg.includes('NEXT_REDIRECT') || msg.includes('redirect')) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    console.error('API error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
