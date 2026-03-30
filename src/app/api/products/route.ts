import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { listProducts } from '@/db/queries/products'

export async function GET(request: Request) {
  try {
    const ctx = await getAuthContext()
    const { searchParams } = new URL(request.url)

    const activeOnly = searchParams.get('activeOnly') === 'true'
    const diagramOnly = searchParams.get('diagramOnly') === 'true'

    const data = await listProducts(ctx.tenantId, { activeOnly, diagramOnly })
    return NextResponse.json(data)
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
}
