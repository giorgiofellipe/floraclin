import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { renegotiateCharges } from '@/db/queries/renegotiation'
import { renegotiateSchema } from '@/validations/financial'
import { handleApiError } from '@/lib/api-error'

export async function POST(request: Request) {
  try {
    const ctx = await getAuthContext()
    // Renegotiate: owner + financial
    if (!['owner', 'financial'].includes(ctx.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await request.json()
    const parsed = renegotiateSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Dados inválidos', fieldErrors: parsed.error.flatten().fieldErrors },
        { status: 400 }
      )
    }

    const result = await renegotiateCharges(ctx.tenantId, ctx.userId, parsed.data)

    return NextResponse.json({ success: true, data: result })
  } catch (error) {
    return handleApiError(error, request)
  }
}
