import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { getTenant } from '@/db/queries/tenants'
import { listProspects, getProspectStats } from '@/db/queries/prospects'
import { prospectFilterSchema } from '@/validations/prospect'
import type { Role } from '@/types'

export async function GET(request: Request) {
  try {
    const ctx = await getAuthContext()

    // Check WhatsApp is enabled and user's role is allowed
    const tenant = await getTenant(ctx.tenantId)
    const settings = (tenant?.settings ?? {}) as Record<string, unknown>
    if (!settings.whatsapp_enabled) {
      return NextResponse.json({ error: 'WhatsApp não está habilitado' }, { status: 403 })
    }
    const allowedRoles = (settings.whatsapp_allowed_roles as string[] | undefined) ?? ['owner']
    if (!allowedRoles.includes(ctx.role as Role) && ctx.role !== 'owner') {
      return NextResponse.json({ error: 'Sem permissão para acessar o CRM' }, { status: 403 })
    }

    // Parse query filters
    const { searchParams } = new URL(request.url)
    const parsed = prospectFilterSchema.safeParse({
      stage: searchParams.get('stage') ?? undefined,
      search: searchParams.get('search') ?? undefined,
      assignedUserId: searchParams.get('assignedUserId') ?? undefined,
    })

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Filtros inválidos', fieldErrors: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    const [prospects, stats] = await Promise.all([
      listProspects(ctx.tenantId, parsed.data),
      getProspectStats(ctx.tenantId),
    ])

    return NextResponse.json({ data: prospects, stats })
  } catch (error) {
    const msg = error instanceof Error ? error.message : ''
    if (msg.includes('Forbidden')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (msg.includes('NEXT_REDIRECT') || msg.includes('redirect')) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    console.error('API error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
