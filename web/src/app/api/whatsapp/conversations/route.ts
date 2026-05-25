import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { getTenant } from '@/db/queries/tenants'
import { listConversations } from '@/db/queries/whatsapp'
import { conversationFilterSchema } from '@/validations/whatsapp'

export async function GET(request: Request) {
  try {
    const ctx = await getAuthContext()

    const tenant = await getTenant(ctx.tenantId)
    if (!tenant) {
      return NextResponse.json({ error: 'Tenant não encontrado' }, { status: 404 })
    }

    const settings = (tenant.settings ?? {}) as Record<string, unknown>
    if (!settings.whatsapp_enabled) {
      return NextResponse.json({ error: 'WhatsApp não habilitado' }, { status: 403 })
    }

    const allowedRoles = (settings.whatsapp_allowed_roles as string[]) ?? ['owner']
    if (!allowedRoles.includes(ctx.role) && ctx.role !== 'owner') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const parsed = conversationFilterSchema.safeParse({
      search: searchParams.get('search') ?? undefined,
      filter: searchParams.get('filter') ?? undefined,
      page: searchParams.get('page') ? Number(searchParams.get('page')) : undefined,
      limit: searchParams.get('limit') ? Number(searchParams.get('limit')) : undefined,
    })

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Dados inválidos', fieldErrors: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    const data = await listConversations(ctx.tenantId, parsed.data)
    return NextResponse.json(data)
  } catch (error) {
    const msg = error instanceof Error ? error.message : ''
    if (msg.includes('Forbidden')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (msg.includes('NEXT_REDIRECT') || msg.includes('redirect')) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    console.error('API error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
