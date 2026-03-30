import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { getPatientTimelineAction } from '@/actions/timeline'

// Timeline uses the existing action logic directly since it's complex
// and contains inline DB queries. We delegate to the action function
// but wrap it in an API route.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await getAuthContext()

    // Only owner and practitioner can view timeline
    if (!['owner', 'practitioner', 'receptionist'].includes(ctx.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { id } = await params
    // The action itself calls getAuthContext() internally
    const data = await getPatientTimelineAction(id)
    return NextResponse.json(data)
  } catch (error) {
    const msg = error instanceof Error ? error.message : ''
    if (msg.includes('Forbidden')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (msg.includes('NEXT_REDIRECT') || msg.includes('redirect')) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    console.error('API error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
