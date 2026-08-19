import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { listPlans, createPlan } from '@/db/queries/subscriptions'
import { handleApiError } from '@/lib/api-error'

export async function GET(request: Request) {
  try {
    const ctx = await getAuthContext()
    if (!ctx.isPlatformAdmin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const allPlans = await listPlans(false)
    return NextResponse.json(allPlans)
  } catch (error) {
    return handleApiError(error, request)
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await getAuthContext()
    if (!ctx.isPlatformAdmin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await request.json()
    const plan = await createPlan(body)
    return NextResponse.json(plan, { status: 201 })
  } catch (error) {
    const msg = error instanceof Error ? error.message : ''

    if (msg.includes('unique') || msg.includes('duplicate')) {
      return NextResponse.json({ error: 'Slug já existe' }, { status: 409 })
    }
    return handleApiError(error, request)
  }
}
