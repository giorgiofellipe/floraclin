import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { listPlans } from '@/db/queries/subscriptions'
import { handleApiError } from '@/lib/api-error'

export async function GET(request: Request) {
  try {
    await getAuthContext()

    const activePlans = await listPlans(true)

    return NextResponse.json({ data: activePlans })
  } catch (error) {
    return handleApiError(error, request)
  }
}
