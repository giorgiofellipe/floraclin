import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { getTemplatesForProcedureTypes } from '@/db/queries/evaluation-templates'

export async function GET(request: Request) {
  try {
    const ctx = await getAuthContext()
    const { searchParams } = new URL(request.url)

    const typeIds = searchParams.get('typeIds')?.split(',').filter(Boolean) ?? []

    if (typeIds.length === 0) {
      return NextResponse.json([])
    }

    const data = await getTemplatesForProcedureTypes(ctx.tenantId, typeIds)
    return NextResponse.json(data)
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
}
