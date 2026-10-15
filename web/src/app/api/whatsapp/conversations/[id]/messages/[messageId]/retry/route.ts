import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { getAuthContext } from '@/lib/auth'
import { getTenant } from '@/db/queries/tenants'
import {
  claimFailedMessageForRetry,
  releaseRetryClaim,
  upsertConversation,
  createMessage,
  pushSseEvent,
  type WhatsappMessage,
} from '@/db/queries/whatsapp'
import { getAppointmentByConfirmationMessageId, relinkConfirmationMessageId } from '@/db/queries/appointments'
import {
  sendTemplateMessage,
  resolveTemplateBody,
  getTemplateForTenant,
} from '@/lib/whatsapp'
import { isWhatsAppEnabled } from '@/lib/whatsapp-mode'
import { buildConfirmationParams } from '@/lib/whatsapp-confirmation'
import { normalizeBrPhoneForWhatsApp } from '@/lib/phone'
import { parseBrDate } from '@/lib/dates'
import { requireWrite } from '@/lib/write-access'
import { handleApiError } from '@/lib/api-error'

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

function badRequest(error: string) {
  return NextResponse.json({ error }, { status: 400 })
}

const RELINK_CONFLICT_WARNING = 'Mensagem reenviada, mas o agendamento mudou durante o reenvio e não foi vinculado.'
const BOOKKEEPING_WARNING = 'Mensagem reenviada, mas não foi possível atualizar o histórico.'

// Runs after Meta accepted the resend: failures here are reported but never
// revert the claim to 'failed', which would offer a duplicate send.
async function recordResend(input: {
  tenantId: string
  retriedMessageId: string
  previousMetaMessageId: string
  metaMessageId: string
  appointment: { id: string; patientId: string | null; patientName: string | null; bookingName: string | null }
  phone: string
  templateName: string
  body: string | null
}): Promise<NextResponse> {
  const { tenantId, appointment } = input
  const report = (error: unknown) => Sentry.captureException(error, {
    tags: { route: 'whatsapp-message-retry' },
    extra: { tenantId, messageId: input.retriedMessageId, metaMessageId: input.metaMessageId },
  })

  let newMessage: WhatsappMessage | null = null
  let warning: string | undefined
  try {
    const conversation = await upsertConversation(
      tenantId,
      input.phone,
      appointment.patientName ?? appointment.bookingName ?? '',
      undefined,
      appointment.patientId ?? undefined,
    )
    newMessage = await createMessage(tenantId, conversation.id, {
      direction: 'outbound',
      metaMessageId: input.metaMessageId,
      body: input.body,
      templateName: input.templateName,
      deliveryStatus: 'sent',
    })
    const relinked = await relinkConfirmationMessageId(
      tenantId,
      appointment.id,
      input.previousMetaMessageId,
      input.metaMessageId,
    )
    if (!relinked) warning = RELINK_CONFLICT_WARNING
  } catch (error) {
    report(error)
    warning = BOOKKEEPING_WARNING
  }

  try {
    await releaseRetryClaim(tenantId, input.retriedMessageId, 'retried')
    if (newMessage) {
      await pushSseEvent(tenantId, 'new_message', { conversationId: newMessage.conversationId, message: newMessage })
    }
  } catch (error) {
    report(error)
    warning = BOOKKEEPING_WARNING
  }

  return NextResponse.json(
    warning ? { success: true, data: newMessage, warning } : { success: true, data: newMessage },
    { status: 201 },
  )
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; messageId: string }> },
): Promise<NextResponse> {
  try {
    const result = await checkWhatsAppAccess()
    if (result.error) return result.error
    const { ctx, tenant } = result

    const { blocked } = await requireWrite('owner', 'practitioner', 'receptionist', 'financial')
    if (blocked) return blocked

    const { id: conversationId, messageId } = await params

    const message = await claimFailedMessageForRetry(ctx.tenantId, conversationId, messageId)
    if (!message) {
      return NextResponse.json(
        { error: 'Reenvio já em andamento ou mensagem não está com falha.' },
        { status: 409 },
      )
    }

    let sent: { metaMessageId: string } | null = null
    try {
      if (!message.metaMessageId || !message.templateName) {
        return badRequest('Esta mensagem não possui template reenviável.')
      }

      const appointment = await getAppointmentByConfirmationMessageId(ctx.tenantId, message.metaMessageId)
      if (!appointment || appointment.patientDeletedAt) {
        return badRequest('Só é possível reenviar confirmações de consulta vinculadas a um agendamento.')
      }
      if (
        appointment.status !== 'scheduled'
        || parseBrDate(appointment.date, appointment.startTime) <= new Date()
      ) {
        return badRequest('Só é possível reenviar confirmações de consultas agendadas e futuras.')
      }

      const phone = appointment.patientPhone ?? appointment.bookingPhone
      if (!phone) {
        return badRequest('Paciente sem telefone cadastrado.')
      }
      const normalizedPhone = normalizeBrPhoneForWhatsApp(phone)

      const template = await getTemplateForTenant(ctx.tenantId, 'appointment_confirmation')
      if (!template || template.status !== 'APPROVED') {
        return badRequest('Template de confirmação não disponível.')
      }

      const templateParams = buildConfirmationParams(appointment, tenant.name)
      sent = await sendTemplateMessage(
        ctx.tenantId,
        normalizedPhone,
        template.name,
        template.language,
        templateParams,
      )

      return await recordResend({
        tenantId: ctx.tenantId,
        retriedMessageId: message.id,
        previousMetaMessageId: message.metaMessageId,
        metaMessageId: sent.metaMessageId,
        appointment,
        phone: normalizedPhone,
        templateName: template.name,
        body: resolveTemplateBody(template.components, templateParams),
      })
    } finally {
      if (!sent) await releaseRetryClaim(ctx.tenantId, message.id, 'failed')
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : ''
    if (msg.includes('Meta API error')) {
      const detail = msg.replace('Meta API error: ', '')
      return NextResponse.json({ error: `Falha ao enviar via WhatsApp: ${detail}` }, { status: 502 })
    }
    return handleApiError(error, request)
  }
}
