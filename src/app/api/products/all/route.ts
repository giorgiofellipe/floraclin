import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { listProducts } from '@/db/queries/products'

export async function GET() {
  try {
    const ctx = await getAuthContext()
    const data = await listProducts(ctx.tenantId)
    return NextResponse.json(data)
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
}
