import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { getTenant } from '@/db/queries/tenants'
import { getProspect, updateProspect, softDeleteProspect, logProspectActivity, getProspectActivities, getProspectProcedures, setProspectProcedures } from '@/db/queries/prospects'
import { pushSseEvent } from '@/db/queries/whatsapp'
import { updateProspectSchema } from '@/validations/prospect'
import type { Role } from '@/types'
import { handleApiError } from '@/lib/api-error'
import { enqueueMetaEvent } from '@/lib/meta/events'
import { hasScheduleForProspect } from '@/db/queries/meta-events'

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
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { ctx, error } = await requireWhatsappAccess()
    if (error) return error

    const { id } = await params
    const prospect = await getProspect(ctx.tenantId, id)
    if (!prospect) {
      return NextResponse.json({ error: 'Lead não encontrado' }, { status: 404 })
    }

    const [activities, interestedProcedures] = await Promise.all([
      getProspectActivities(ctx.tenantId, id),
      getProspectProcedures(id),
    ])

    return NextResponse.json({ data: { ...prospect, interestedProcedures }, activities })
  } catch (error) {
    return handleApiError(error, request)
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

    const existing = await getProspect(ctx.tenantId, id)
    if (!existing) {
      return NextResponse.json({ error: 'Lead não encontrado' }, { status: 404 })
    }

    const { procedureTypeIds, ...updateData } = parsed.data
    const prospect = await updateProspect(ctx.tenantId, id, updateData)
    if (!prospect) {
      return NextResponse.json({ error: 'Lead não encontrado' }, { status: 404 })
    }

    if (procedureTypeIds !== undefined) {
      await setProspectProcedures(ctx.tenantId, id, procedureTypeIds)
    }

    if (parsed.data.stage && parsed.data.stage !== existing.stage) {
      await logProspectActivity(ctx.tenantId, id, 'stage_changed', {
        from: existing.stage,
        to: parsed.data.stage,
      }, ctx.userId)

      if (parsed.data.stage === 'contatado') {
        await enqueueMetaEvent({
          tenantId: ctx.tenantId,
          eventName: 'Contact',
          eventId: `contact:${id}`,
          eventTime: new Date(),
          prospectId: id,
          contact: { phone: prospect.phone, fullName: prospect.name },
          actionSource: 'system_generated',
        })
      } else if (parsed.data.stage === 'agendado') {
        // A lead that already has a real appointment already produced a
        // Schedule under the appointment's id; the unique index can't
        // catch that here because the event ids differ.
        const alreadyScheduled = await hasScheduleForProspect(ctx.tenantId, id)
        if (!alreadyScheduled) {
          await enqueueMetaEvent({
            tenantId: ctx.tenantId,
            eventName: 'Schedule',
            eventId: `schedule:${id}`,
            eventTime: new Date(),
            prospectId: id,
            contact: { phone: prospect.phone, fullName: prospect.name },
            actionSource: 'system_generated',
          })
        }
      }
    }
    if (parsed.data.assignedUserId !== undefined && parsed.data.assignedUserId !== existing.assignedUserId) {
      await logProspectActivity(ctx.tenantId, id, 'assigned', {
        from: existing.assignedUserId,
        to: parsed.data.assignedUserId,
      }, ctx.userId)
    }
    if (parsed.data.notes !== undefined && parsed.data.notes !== existing.notes) {
      await logProspectActivity(ctx.tenantId, id, 'note_updated', null, ctx.userId)
    }
    if (parsed.data.lostReason !== undefined) {
      await logProspectActivity(ctx.tenantId, id, 'lost', {
        reason: parsed.data.lostReason,
      }, ctx.userId)
    }

    await pushSseEvent(ctx.tenantId, 'prospect_updated', { prospectId: id, ...parsed.data })

    return NextResponse.json({ data: prospect })
  } catch (error) {
    return handleApiError(error, request)
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { ctx, error } = await requireWhatsappAccess()
    if (error) return error

    const { id } = await params
    const prospect = await softDeleteProspect(ctx.tenantId, id)
    if (!prospect) {
      return NextResponse.json({ error: 'Lead não encontrado' }, { status: 404 })
    }

    await logProspectActivity(ctx.tenantId, id, 'deleted', null, ctx.userId)
    await pushSseEvent(ctx.tenantId, 'prospect_updated', { prospectId: id, deleted: true })

    return NextResponse.json({ success: true })
  } catch (error) {
    return handleApiError(error, request)
  }
}
