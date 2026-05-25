import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { getTenant } from '@/db/queries/tenants'
import { getProspect, updateProspect, softDeleteProspect } from '@/db/queries/prospects'
import { pushSseEvent } from '@/db/queries/whatsapp'
import { updateProspectSchema } from '@/validations/prospect'
import type { Role } from '@/types'

async function requireWhatsappAccess() {
  const ctx = await getAuthContext()

  const tenant = await getTenant(ctx.tenantId)
  const settings = (tenant?.settings ?? {}) as Record<string, unknown>
  if (!settings.whatsapp_enabled) {
    return { ctx: null, error: NextResponse.json({ error: 'WhatsApp não está habilitado' }, { status: 403 }) }
  }
  const allowedRoles = (settings.whatsapp_allowed_roles as string[] | undefined) ?? ['owner']
  if (!allowedRoles.includes(ctx.role as Role) && ctx.role !== 'owner') {
    return { ctx: null, error: NextResponse.json({ error: 'Sem permissão para acessar o CRM' }, { status: 403 }) }
  }

  return { ctx, error: null }
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { ctx, error } = await requireWhatsappAccess()
    if (error) return error

    const { id } = await params
    const prospect = await getProspect(ctx.tenantId, id)
    if (!prospect) {
      return NextResponse.json({ error: 'Prospect não encontrado' }, { status: 404 })
    }

    return NextResponse.json({ data: prospect })
  } catch (error) {
    const msg = error instanceof Error ? error.message : ''
    if (msg.includes('Forbidden')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (msg.includes('NEXT_REDIRECT') || msg.includes('redirect')) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    console.error('API error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { ctx, error } = await requireWhatsappAccess()
    if (error) return error

    const { id } = await params
    const body = await request.json()
    const parsed = updateProspectSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Dados inválidos', fieldErrors: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    const prospect = await updateProspect(ctx.tenantId, id, parsed.data)
    if (!prospect) {
      return NextResponse.json({ error: 'Prospect não encontrado' }, { status: 404 })
    }

    await pushSseEvent(ctx.tenantId, 'prospect_updated', { prospectId: id, ...parsed.data })

    return NextResponse.json({ data: prospect })
  } catch (error) {
    const msg = error instanceof Error ? error.message : ''
    if (msg.includes('Forbidden')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (msg.includes('NEXT_REDIRECT') || msg.includes('redirect')) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    console.error('API error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { ctx, error } = await requireWhatsappAccess()
    if (error) return error

    const { id } = await params
    const prospect = await softDeleteProspect(ctx.tenantId, id)
    if (!prospect) {
      return NextResponse.json({ error: 'Prospect não encontrado' }, { status: 404 })
    }

    await pushSseEvent(ctx.tenantId, 'prospect_updated', { prospectId: id, deleted: true })

    return NextResponse.json({ success: true })
  } catch (error) {
    const msg = error instanceof Error ? error.message : ''
    if (msg.includes('Forbidden')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (msg.includes('NEXT_REDIRECT') || msg.includes('redirect')) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    console.error('API error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
