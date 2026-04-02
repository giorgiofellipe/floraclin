import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { renegotiateCharges } from '@/db/queries/renegotiation'
import { renegotiateSchema } from '@/validations/financial'

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
    const msg = error instanceof Error ? error.message : ''
    if (msg.includes('Forbidden')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (msg.includes('NEXT_REDIRECT') || msg.includes('redirect')) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (
      msg.includes('não encontradas') ||
      msg.includes('mesmo paciente') ||
      msg.includes('renegociadas') ||
      msg.includes('positivo')
    ) {
      return NextResponse.json({ error: msg }, { status: 400 })
    }
    console.error('Renegotiate API error:', error instanceof Error ? error.stack : error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
