import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { signOAuthState, buildAuthUrl } from '@/lib/google-calendar'

export async function GET(request: Request) {
  try {
    const ctx = await getAuthContext()

    if (!['owner', 'practitioner'].includes(ctx.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const type = searchParams.get('type') as 'practitioner' | 'clinic' | null

    if (!type || !['practitioner', 'clinic'].includes(type)) {
      return NextResponse.json({ error: 'Parâmetro "type" inválido.' }, { status: 400 })
    }

    if (type === 'clinic' && ctx.role !== 'owner') {
      return NextResponse.json(
        { error: 'Apenas o proprietário pode conectar o calendário da clínica.' },
        { status: 403 },
      )
    }

    const state = signOAuthState({
      userId: ctx.userId,
      tenantId: ctx.tenantId,
      type,
    })

    const authUrl = buildAuthUrl(state)
    return NextResponse.redirect(authUrl)
  } catch (error) {
    const msg = error instanceof Error ? error.message : ''
    if (msg.includes('NEXT_REDIRECT') || msg.includes('redirect')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('Calendar connect error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
