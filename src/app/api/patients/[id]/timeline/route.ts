import { NextResponse } from 'next/server'
import { getPatientTimelineAction } from '@/actions/timeline'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    // getPatientTimelineAction already calls getAuthContext() internally
    const data = await getPatientTimelineAction(id)
    return NextResponse.json(data)
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
}
