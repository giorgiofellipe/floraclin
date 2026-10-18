import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { listCardRepasses } from '@/db/queries/card-payments'
import { listRepassesQuerySchema } from '@/validations/card-repasses'
import { handleApiError } from '@/lib/api-error'

export async function GET(request: Request) {
  try {
    const ctx = await getAuthContext()

    const params = Object.fromEntries(new URL(request.url).searchParams)
    const parsed = listRepassesQuerySchema.safeParse(params)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Dados inválidos', fieldErrors: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    const { rows, total, pendingNetTotal } = await listCardRepasses(ctx.tenantId, parsed.data)
    return NextResponse.json({ data: rows, total, pendingNetTotal })
  } catch (error) {
    return handleApiError(error, request)
  }
}
