import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { getTenant } from '@/db/queries/tenants'
import { createSavedReply, listSavedReplies } from '@/db/queries/instagram'
import { savedReplyInputSchema } from '@/validations/instagram'

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

export async function GET() {
  try {
    const { ctx } = await checkInstagramAccess()
    const replies = await listSavedReplies(ctx.tenantId)
    return NextResponse.json({ data: replies })
  } catch (error) {
    const msg = error instanceof Error ? error.message : ''
    if (msg === 'Forbidden') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (msg.includes('NEXT_REDIRECT') || msg.includes('redirect')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('Error listing Instagram saved replies:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const { ctx } = await checkInstagramAccess()
    const body = await request.json()
    const parsed = savedReplyInputSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Dados inválidos', fieldErrors: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    const variableKeys = extractVariableKeys(parsed.data.body)

    const created = await createSavedReply(ctx.tenantId, {
      name: parsed.data.name,
      body: parsed.data.body,
      variableKeys,
      purposeKey: parsed.data.purposeKey ?? null,
    })

    return NextResponse.json({ data: created }, { status: 201 })
  } catch (error) {
    const msg = error instanceof Error ? error.message : ''
    if (msg === 'Forbidden') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (msg.includes('NEXT_REDIRECT') || msg.includes('redirect')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('Error creating Instagram saved reply:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
