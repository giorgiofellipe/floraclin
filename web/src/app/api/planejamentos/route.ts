import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { listOpenPlanejamentos } from '@/db/queries/followups'

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
    const msg = error instanceof Error ? error.message : ''
    if (msg.includes('Forbidden'))
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (msg.includes('NEXT_REDIRECT') || msg.includes('redirect'))
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    console.error('API error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
