import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { getAvailableSlots } from '@/db/queries/appointments'

export async function GET(request: Request) {
  try {
    const ctx = await getAuthContext()
    const { searchParams } = new URL(request.url)

    const practitionerId = searchParams.get('practitionerId') ?? ''
    const date = searchParams.get('date') ?? ''
    const durationMin = Number(searchParams.get('durationMin') ?? '30')

    if (!practitionerId || !date) {
      return NextResponse.json(
        { error: 'practitionerId and date are required' },
        { status: 400 }
      )
    }

    const data = await getAvailableSlots(ctx.tenantId, practitionerId, date, durationMin)
    return NextResponse.json(data)
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
}
