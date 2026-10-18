import { NextResponse } from 'next/server'
import { requireWrite } from '@/lib/write-access'
import { deleteCardTerminal, updateCardTerminal } from '@/db/queries/card-terminals'
import { cardTerminalSchema } from '@/validations/card-terminals'
import { handleApiError } from '@/lib/api-error'
import { BusinessError } from '@/lib/errors'

type RouteContext = { params: Promise<{ id: string }> }

function notFound(error: unknown) {
  if (error instanceof BusinessError && error.code === 'CARD_TERMINAL_NOT_FOUND') {
    return NextResponse.json({ error: error.message }, { status: 404 })
  }
  return null
}

export async function PATCH(request: Request, { params }: RouteContext) {
  try {
    const { ctx, blocked } = await requireWrite('owner')
    if (blocked) return blocked
    const { id } = await params

    const parsed = cardTerminalSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Dados inválidos', fieldErrors: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    const terminal = await updateCardTerminal(ctx.tenantId, ctx.userId, id, parsed.data)
    return NextResponse.json({ success: true, data: terminal })
  } catch (error) {
    return notFound(error) ?? handleApiError(error, request)
  }
}

export async function DELETE(request: Request, { params }: RouteContext) {
  try {
    const { ctx, blocked } = await requireWrite('owner')
    if (blocked) return blocked
    const { id } = await params

    await deleteCardTerminal(ctx.tenantId, ctx.userId, id)
    return NextResponse.json({ success: true })
  } catch (error) {
    return notFound(error) ?? handleApiError(error, request)
  }
}
