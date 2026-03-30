import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { listPatients } from '@/db/queries/patients'

export async function GET(request: Request) {
  try {
    const ctx = await getAuthContext()
    const { searchParams } = new URL(request.url)

    const search = searchParams.get('search') ?? ''
    const page = Number(searchParams.get('page') ?? '1')
    const limit = Number(searchParams.get('limit') ?? '20')
    const responsibleUserId = searchParams.get('responsibleUserId') ?? undefined

    const data = await listPatients(ctx.tenantId, { search, page, limit, responsibleUserId })
    return NextResponse.json(data)
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
}
