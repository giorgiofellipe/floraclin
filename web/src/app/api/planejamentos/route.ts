import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { listOpenPlanejamentos } from '@/db/queries/followups'
import { handleApiError } from '@/lib/api-error'

export async function GET(request: Request) {
  try {
    const ctx = await getAuthContext()
    const { searchParams } = new URL(request.url)

    const practitionerParam = searchParams.get('practitionerId') ?? undefined
    const procedureTypeId = searchParams.get('procedureTypeId') ?? undefined
    const includeSnoozed = searchParams.get('includeSnoozed') === 'true'
    const limitParam = searchParams.get('limit')
    const limit = limitParam ? Math.max(1, Math.min(500, Number(limitParam))) : undefined

    // Practitioners only see their own planejamentos
    const practitionerId =
      ctx.role === 'practitioner' ? ctx.userId : practitionerParam || undefined

    const data = await listOpenPlanejamentos({
      tenantId: ctx.tenantId,
      practitionerId,
      procedureTypeId,
      includeSnoozed,
      limit,
    })

    return NextResponse.json({ data })
  } catch (error) {
    return handleApiError(error, request)
  }
}
