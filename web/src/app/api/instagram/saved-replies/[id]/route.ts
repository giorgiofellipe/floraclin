import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { getTenant } from '@/db/queries/tenants'
import {
  archiveSavedReply,
  getSavedReplyById,
  updateSavedReply,
} from '@/db/queries/instagram'
import { savedReplyInputSchema } from '@/validations/instagram'

type RouteParams = { params: Promise<{ id: string }> }

function extractVariableKeys(body: string): string[] {
  const re = /\{\{(\w+)\}\}/g
  const keys = new Set<string>()
  let match: RegExpExecArray | null
  while ((match = re.exec(body)) !== null) keys.add(match[1])
  return Array.from(keys)
}

async function checkInstagramAccess() {
  const ctx = await getAuthContext()
  const tenant = await getTenant(ctx.tenantId)
  const settings = tenant?.settings as Record<string, unknown> | null
  const allowedRoles = (settings?.instagram_allowed_roles as string[]) ?? ['owner']
  if (ctx.role !== 'owner' && !allowedRoles.includes(ctx.role)) {
    throw new Error('Forbidden')
  }
  return { ctx, tenant, settings }
}

const updateSavedReplySchema = savedReplyInputSchema.partial()

export async function PATCH(request: Request, { params }: RouteParams) {
  try {
    const { id } = await params
    const { ctx } = await checkInstagramAccess()

    const existing = await getSavedReplyById(ctx.tenantId, id)
    if (!existing) {
      return NextResponse.json({ error: 'Resposta salva não encontrada' }, { status: 404 })
    }

    const body = await request.json()
    const parsed = updateSavedReplySchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Dados inválidos', fieldErrors: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    const patch: {
      name?: string
      body?: string
      variableKeys?: string[]
      purposeKey?: string | null
    } = {}
    if (parsed.data.name !== undefined) patch.name = parsed.data.name
    if (parsed.data.body !== undefined) {
      patch.body = parsed.data.body
      patch.variableKeys = extractVariableKeys(parsed.data.body)
    }
    if (parsed.data.purposeKey !== undefined) patch.purposeKey = parsed.data.purposeKey ?? null

    const updated = await updateSavedReply(ctx.tenantId, id, patch)
    if (!updated) {
      return NextResponse.json({ error: 'Resposta salva não encontrada' }, { status: 404 })
    }

    return NextResponse.json({ data: updated })
  } catch (error) {
    const msg = error instanceof Error ? error.message : ''
    if (msg === 'Forbidden') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (msg.includes('NEXT_REDIRECT') || msg.includes('redirect')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('Error updating Instagram saved reply:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  try {
    const { id } = await params
    const { ctx } = await checkInstagramAccess()

    const existing = await getSavedReplyById(ctx.tenantId, id)
    if (!existing) {
      return NextResponse.json({ error: 'Resposta salva não encontrada' }, { status: 404 })
    }

    await archiveSavedReply(ctx.tenantId, id)
    return NextResponse.json({ success: true })
  } catch (error) {
    const msg = error instanceof Error ? error.message : ''
    if (msg === 'Forbidden') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (msg.includes('NEXT_REDIRECT') || msg.includes('redirect')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('Error archiving Instagram saved reply:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
