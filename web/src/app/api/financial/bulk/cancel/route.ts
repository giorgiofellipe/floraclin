import { NextResponse } from 'next/server'
import { requireWrite } from '@/lib/write-access'
import { bulkCancelEntries } from '@/db/queries/financial'
import { bulkCancelSchema } from '@/validations/financial'
import { handleApiError } from '@/lib/api-error'

export async function POST(request: Request) {
  try {
    const { ctx, blocked } = await requireWrite('owner', 'financial')
    if (blocked) return blocked

    const body = await request.json()
    const parsed = bulkCancelSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Dados inválidos', fieldErrors: parsed.error.flatten().fieldErrors },
        { status: 400 }
      )
    }

    const result = await bulkCancelEntries(ctx.tenantId, ctx.userId, parsed.data)

    return NextResponse.json({ success: true, data: result })
  } catch (error) {
    const msg = error instanceof Error ? error.message : ''
    if (msg.includes('não encontradas')) {
      return NextResponse.json({ error: msg }, { status: 400 })
    }
    return handleApiError(error, request)
  }
}
