import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { listAppointments } from '@/db/queries/appointments'

export async function GET(request: Request) {
  try {
    const ctx = await getAuthContext()
    const { searchParams } = new URL(request.url)

    const practitionerId = searchParams.get('practitionerId') ?? undefined
    const dateFrom = searchParams.get('dateFrom') ?? ''
    const dateTo = searchParams.get('dateTo') ?? ''

    if (!dateFrom || !dateTo) {
      return NextResponse.json(
        { error: 'dateFrom and dateTo are required' },
        { status: 400 }
      )
    }

    const data = await listAppointments(ctx.tenantId, {
      practitionerId,
      dateFrom,
      dateTo,
    })

    return NextResponse.json(data)
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
}
