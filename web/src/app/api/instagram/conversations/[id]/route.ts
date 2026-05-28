import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { getTenant } from '@/db/queries/tenants'
import {
  getConversationById,
  markConversationRead,
  linkPatient,
  unlinkPatient,
} from '@/db/queries/instagram'
import { getPatient } from '@/db/queries/patients'
import { conversationActionSchema } from '@/validations/instagram'

async function checkInstagramAccess() {
  const ctx = await getAuthContext()

  const tenant = await getTenant(ctx.tenantId)
  if (!tenant) {
    return { error: NextResponse.json({ error: 'Tenant não encontrado' }, { status: 404 }) }
  }

  const settings = (tenant.settings ?? {}) as Record<string, unknown>
  if (!settings.instagram_enabled) {
    return { error: NextResponse.json({ error: 'Instagram não habilitado' }, { status: 403 }) }
  }

  const allowedRoles = (settings.instagram_allowed_roles as string[]) ?? ['owner']
  if (!allowedRoles.includes(ctx.role) && ctx.role !== 'owner') {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }

  return { ctx }
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const result = await checkInstagramAccess()
    if ('error' in result) return result.error
    const { ctx } = result

    const { id } = await params
    const conversation = await getConversationById(ctx.tenantId, id)
    if (!conversation) {
      return NextResponse.json({ error: 'Conversa não encontrada' }, { status: 404 })
    }
    return NextResponse.json(conversation)
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
    const result = await checkInstagramAccess()
    if ('error' in result) return result.error
    const { ctx } = result

    const { id } = await params

    const body = await request.json()
    const parsed = conversationActionSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Dados inválidos', fieldErrors: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    const existing = await getConversationById(ctx.tenantId, id)
    if (!existing) {
      return NextResponse.json({ error: 'Conversa não encontrada' }, { status: 404 })
    }

    if (parsed.data.action === 'mark_read') {
      await markConversationRead(ctx.tenantId, id)
      return NextResponse.json({ success: true })
    }

    if (parsed.data.action === 'link_patient') {
      // Verify the patient belongs to the same tenant before linking.
      const patient = await getPatient(ctx.tenantId, parsed.data.patientId)
      if (!patient) {
        return NextResponse.json({ error: 'Paciente não encontrado' }, { status: 404 })
      }
      await linkPatient(ctx.tenantId, id, parsed.data.patientId)
      return NextResponse.json({ success: true })
    }

    // unlink_patient
    await unlinkPatient(ctx.tenantId, id)
    return NextResponse.json({ success: true })
  } catch (error) {
    const msg = error instanceof Error ? error.message : ''
    if (msg.includes('Forbidden')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (msg.includes('NEXT_REDIRECT') || msg.includes('redirect')) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    console.error('API error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
