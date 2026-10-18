import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { requireWrite } from '@/lib/write-access'
import { createCardTerminal, listCardTerminals } from '@/db/queries/card-terminals'
import { cardTerminalSchema } from '@/validations/card-terminals'
import { handleApiError } from '@/lib/api-error'

export async function GET(request: Request) {
  try {
    const ctx = await getAuthContext()
    const terminals = await listCardTerminals(ctx.tenantId)
    return NextResponse.json({ data: terminals })
  } catch (error) {
    return handleApiError(error, request)
  }
}

export async function POST(request: Request) {
  try {
    const { ctx, blocked } = await requireWrite('owner')
    if (blocked) return blocked

    const parsed = cardTerminalSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Dados inválidos', fieldErrors: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    const terminal = await createCardTerminal(ctx.tenantId, ctx.userId, parsed.data)
    return NextResponse.json({ success: true, data: terminal })
  } catch (error) {
    return handleApiError(error, request)
  }
}
