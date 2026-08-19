import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { updatePlan } from '@/db/queries/subscriptions'
import { handleApiError } from '@/lib/api-error'

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await getAuthContext()
    if (!ctx.isPlatformAdmin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { id } = await params
    const body = await request.json()
    const plan = await updatePlan(id, body)
    return NextResponse.json(plan)
  } catch (error) {
    return handleApiError(error, request)
  }
}
