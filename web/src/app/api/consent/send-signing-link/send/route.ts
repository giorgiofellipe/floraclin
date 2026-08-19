import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthContext } from '@/lib/auth'
import { getTenant } from '@/db/queries/tenants'
import { getPatient } from '@/db/queries/patients'
import { getTemplateByPurpose, upsertConversation, createMessage, pushSseEvent } from '@/db/queries/whatsapp'
import { sendTemplateMessage, resolveTemplateBody } from '@/lib/whatsapp'
import { SubscriptionExpiredError, SUBSCRIPTION_EXPIRED_RESPONSE } from '@/lib/plans'
import { CONSENT_SIGNING_TEMPLATE_PURPOSE } from '@/validations/consent'
import { toWhatsAppPhone } from '@/lib/phone'
import { handleApiError } from '@/lib/api-error'

const sendSchema = z.object({
  url: z.string().url(),
  patientId: z.string().uuid(),
})

export async function POST(request: Request) {
  try {
    const ctx = await getAuthContext()
    if (!['owner', 'practitioner'].includes(ctx.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await request.json()
    const parsed = sendSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Dados inválidos' }, { status: 400 })
    }

    const tenant = await getTenant(ctx.tenantId)
    if (!tenant) {
      return NextResponse.json({ error: 'Clínica não encontrada' }, { status: 404 })
    }
    const settings = (tenant.settings ?? {}) as Record<string, unknown>
    if (!settings.whatsapp_enabled) {
      return NextResponse.json({ error: 'WhatsApp não habilitado' }, { status: 403 })
    }

    const patient = await getPatient(ctx.tenantId, parsed.data.patientId)
    if (!patient) {
      return NextResponse.json({ error: 'Paciente não encontrado' }, { status: 404 })
    }
    if (!patient.phone) {
      return NextResponse.json({ error: 'Paciente sem telefone cadastrado' }, { status: 400 })
    }

    const template = await getTemplateByPurpose(ctx.tenantId, CONSENT_SIGNING_TEMPLATE_PURPOSE)
    if (!template) {
      return NextResponse.json(
        { error: 'Template de assinatura não cadastrado. Cadastre um template com finalidade "consent_signing_link".' },
        { status: 400 },
      )
    }
    if (template.status !== 'APPROVED') {
      return NextResponse.json(
        { error: 'Template de assinatura aguardando aprovação da Meta.' },
        { status: 400 },
      )
    }

    const normalizedPhone = toWhatsAppPhone(patient.phone)
    const firstName = patient.fullName.split(' ')[0]

    const templateParams = { '1': firstName, '2': tenant.name, '3': parsed.data.url }
    const result = await sendTemplateMessage(
      ctx.tenantId,
      normalizedPhone,
      template.name,
      template.language,
      templateParams,
    )

    const conversation = await upsertConversation(
      ctx.tenantId,
      normalizedPhone,
      patient.fullName,
      undefined,
      parsed.data.patientId,
    )

    const message = await createMessage(ctx.tenantId, conversation.id, {
      direction: 'outbound',
      metaMessageId: result.metaMessageId,
      body: resolveTemplateBody(template.components, templateParams),
      templateName: template.name,
      deliveryStatus: 'sent',
    })

    await pushSseEvent(ctx.tenantId, 'new_message', {
      conversationId: conversation.id,
      message,
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    if (error instanceof SubscriptionExpiredError) {
      return NextResponse.json(SUBSCRIPTION_EXPIRED_RESPONSE.body, { status: SUBSCRIPTION_EXPIRED_RESPONSE.status })
    }
    const msg = error instanceof Error ? error.message : ''
    if (msg.includes('Meta API error')) {
      return NextResponse.json({ error: `Falha ao enviar via WhatsApp: ${msg.replace('Meta API error: ', '')}` }, { status: 502 })
    }
    return handleApiError(error, request)
  }
}
