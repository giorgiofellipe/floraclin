import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { uncancelEntries } from '@/db/queries/financial'
import { bulkUncancelSchema } from '@/validations/financial'
import { handleApiError } from '@/lib/api-error'
import { BusinessError } from '@/lib/errors'

export async function POST(request: Request) {
  try {
    const ctx = await getAuthContext()
    // Bulk uncancel: owner + financial
    if (!['owner', 'financial'].includes(ctx.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await request.json()
    const parsed = bulkUncancelSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Dados inválidos', fieldErrors: parsed.error.flatten().fieldErrors },
        { status: 400 }
      )
    }

    const result = await uncancelEntries(ctx.tenantId, ctx.userId, parsed.data)

    return NextResponse.json({ success: true, data: result })
  } catch (error) {
    if (error instanceof BusinessError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 409 })
    }
    return handleApiError(error, request)
  }
}
