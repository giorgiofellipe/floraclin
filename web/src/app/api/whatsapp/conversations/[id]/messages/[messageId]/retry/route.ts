import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { getTenant } from '@/db/queries/tenants'
import { getConversation, getMessage, upsertConversation, createMessage, pushSseEvent, getTemplateByName } from '@/db/queries/whatsapp'
import { getAppointmentByConfirmationMessageId, updateConfirmationMessageId } from '@/db/queries/appointments'
import { sendTemplateMessage, resolveTemplateBody, isWhatsAppEnabled, getTemplateForTenant } from '@/lib/whatsapp'
import { normalizeBrPhoneForWhatsApp, InvalidWhatsAppPhoneError } from '@/lib/phone'
import { requireWrite } from '@/lib/write-access'
import { handleApiError } from '@/lib/api-error'

const inFlightRetries = new Set<string>()

async function checkWhatsAppAccess() {
  const ctx = await getAuthContext()

  const tenant = await getTenant(ctx.tenantId)
  if (!tenant) {
    return { error: NextResponse.json({ error: 'Tenant não encontrado' }, { status: 404 }) }
  }

  const settings = (tenant.settings ?? {}) as Record<string, unknown>
  if (!isWhatsAppEnabled(settings)) {
    return { error: NextResponse.json({ error: 'WhatsApp não habilitado' }, { status: 403 }) }
  }

  const allowedRoles = (settings.whatsapp_allowed_roles as string[]) ?? ['owner']
  if (!allowedRoles.includes(ctx.role) && ctx.role !== 'owner') {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }

  return { ctx, tenant }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; messageId: string }> },
) {
  let retryKey: string | null = null

  try {
    const result = await checkWhatsAppAccess()
    if ('error' in result) return result.error
    const { ctx, tenant } = result

    const { blocked } = await requireWrite('owner', 'practitioner', 'receptionist', 'financial')
    if (blocked) return blocked

    const { id: conversationId, messageId } = await params
    retryKey = `${ctx.tenantId}:${messageId}`
    if (inFlightRetries.has(retryKey)) {
      return NextResponse.json({ error: 'Reenvio já em andamento para esta mensagem.' }, { status: 409 })
    }
    inFlightRetries.add(retryKey)

    const [conversation, message] = await Promise.all([
      getConversation(ctx.tenantId, conversationId),
      getMessage(ctx.tenantId, conversationId, messageId),
    ])
    if (!conversation || !message) {
      return NextResponse.json({ error: 'Mensagem não encontrada' }, { status: 404 })
    }
    if (message.direction !== 'outbound' || message.deliveryStatus !== 'failed') {
      return NextResponse.json({ error: 'Somente mensagens enviadas com falha podem ser reenviadas.' }, { status: 400 })
    }
    if (!message.metaMessageId || !message.templateName) {
      return NextResponse.json({ error: 'Esta mensagem não possui template reenviável.' }, { status: 400 })
    }

    const appointment = await getAppointmentByConfirmationMessageId(ctx.tenantId, message.metaMessageId)
    if (!appointment) {
      return NextResponse.json(
        { error: 'Só é possível reenviar confirmações de consulta vinculadas a um agendamento.' },
        { status: 400 },
      )
    }

    const phone = appointment.patientPhone ?? appointment.bookingPhone
    if (!phone) {
      return NextResponse.json({ error: 'Paciente sem telefone cadastrado' }, { status: 400 })
    }

    const normalizedPhone = normalizeBrPhoneForWhatsApp(phone)
    const name = appointment.patientName ?? appointment.bookingName ?? ''
    const paramsForTemplate: Record<string, string> = {
      '1': name.split(' ')[0] || name,
      '2': tenant.name,
      '3': formatDateBr(appointment.date),
      '4': appointment.startTime.slice(0, 5),
    }

    const template =
      await getTemplateByName(ctx.tenantId, message.templateName, 'pt_BR')
      ?? await getTemplateForTenant(ctx.tenantId, 'appointment_confirmation')

    if (!template || template.status !== 'APPROVED') {
      return NextResponse.json({ error: 'Template de confirmação não disponível.' }, { status: 400 })
    }

    const sent = await sendTemplateMessage(
      ctx.tenantId,
      normalizedPhone,
      template.name,
      template.language,
      paramsForTemplate,
    )

    await updateConfirmationMessageId(ctx.tenantId, appointment.id, sent.metaMessageId)

    const targetConversation = await upsertConversation(
      ctx.tenantId,
      normalizedPhone,
      name,
      undefined,
      appointment.patientId ?? undefined,
    )

    const newMessage = await createMessage(ctx.tenantId, targetConversation.id, {
      direction: 'outbound',
      metaMessageId: sent.metaMessageId,
      body: resolveTemplateBody(template.components, paramsForTemplate),
      templateName: template.name,
      deliveryStatus: 'sent',
    })

    await pushSseEvent(ctx.tenantId, 'new_message', {
      conversationId: targetConversation.id,
      message: newMessage,
    })

    return NextResponse.json({ success: true, data: newMessage, conversation: targetConversation }, { status: 201 })
  } catch (error) {
    if (error instanceof InvalidWhatsAppPhoneError) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    const msg = error instanceof Error ? error.message : ''
    if (msg.includes('Meta API error')) {
      const detail = msg.replace('Meta API error: ', '')
      return NextResponse.json({ error: `Falha ao enviar via WhatsApp: ${detail}` }, { status: 502 })
    }
    return handleApiError(error, request)
  } finally {
    if (retryKey) inFlightRetries.delete(retryKey)
  }
}

function formatDateBr(dateStr: string): string {
  const [y, m, d] = dateStr.split('-')
  return `${d}/${m}/${y}`
}
