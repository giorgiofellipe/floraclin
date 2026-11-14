import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { nextBookableSlot } from '@/lib/booking-slots'
import { handleApiError } from '@/lib/api-error'

const YMD = /^\d{4}-\d{2}-\d{2}$/

// GET /api/appointments/next-free-slot?practitionerId=X&from=YYYY-MM-DD: the first free half hour beyond what the agenda has loaded.
export async function GET(request: Request) {
  try {
    const ctx = await getAuthContext()
    const { searchParams } = new URL(request.url)
    const practitionerId = searchParams.get('practitionerId') ?? ''
    const from = searchParams.get('from') ?? ''
    if (!practitionerId || !YMD.test(from)) {
      return NextResponse.json({ error: 'practitionerId e from são obrigatórios' }, { status: 400 })
    }
    return NextResponse.json({ data: await nextBookableSlot(ctx.tenantId, practitionerId, from) })
  } catch (error) {
    return handleApiError(error, request)
  }
}
