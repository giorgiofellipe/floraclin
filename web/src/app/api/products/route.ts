import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { createAuditLog } from '@/lib/audit'
import { listProducts, createProduct } from '@/db/queries/products'
import { handleApiError } from '@/lib/api-error'

export async function GET(request: Request) {
  try {
    const ctx = await getAuthContext()
    const { searchParams } = new URL(request.url)
    const filter = searchParams.get('filter') ?? 'active'

    if (filter === 'all' && ctx.role !== 'owner') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const options = {
      activeOnly: filter === 'active',
      diagramOnly: filter === 'diagram',
    }

    const products = await listProducts(ctx.tenantId, filter === 'all' ? {} : options)
    return NextResponse.json(products)
  } catch (error) {
    return handleApiError(error, request)
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await getAuthContext()
    if (ctx.role !== 'owner') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await request.json()
    if (!body.name?.trim() || !body.category?.trim()) {
      return NextResponse.json({ error: 'Nome e categoria são obrigatórios' }, { status: 400 })
    }

    const product = await createProduct(ctx.tenantId, body)

    await createAuditLog({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'create',
      entityType: 'product',
      entityId: product.id,
      changes: { product: { old: null, new: body } },
    })

    return NextResponse.json({ success: true, data: product })
  } catch (error) {
    return handleApiError(error, request)
  }
}
