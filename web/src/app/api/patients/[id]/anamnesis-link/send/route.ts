import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthContext } from '@/lib/auth'
import { getTenant } from '@/db/queries/tenants'
import { getPatient } from '@/db/queries/patients'
import { getTemplateByPurpose, upsertConversation, createMessage, pushSseEvent } from '@/db/queries/whatsapp'
import { sendTemplateMessage, resolveTemplateBody } from '@/lib/whatsapp'

const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''

const bodySchema = z.object({
  url: z.string().url().refine(
    (u) => appUrl && u.startsWith(appUrl),
    'URL must belong to this application',
  ),
})

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await getAuthContext()
    if (!['owner', 'practitioner', 'receptionist'].includes(ctx.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const tenant = await getTenant(ctx.tenantId)
    const settings = (tenant?.settings ?? {}) as Record<string, unknown>
    if (!settings.whatsapp_enabled) {
      return NextResponse.json({ error: 'WhatsApp não habilitado' }, { status: 403 })
    }

    const { id: patientId } = await params
    const patient = await getPatient(ctx.tenantId, patientId)
    if (!patient) {
      return NextResponse.json({ error: 'Paciente não encontrado' }, { status: 404 })
    }
    if (!patient.phone) {
      return NextResponse.json({ error: 'Paciente sem telefone cadastrado' }, { status: 400 })
    }

    const body = await request.json()
    const parsed = bodySchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Dados inválidos', fieldErrors: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    const template = await getTemplateByPurpose(ctx.tenantId, 'anamnese_link')
    if (!template) {
      return NextResponse.json({ error: 'Template de anamnese não cadastrado. Cadastre um template com finalidade "anamnese_link".' }, { status: 400 })
    }
    if (template.status !== 'APPROVED') {
      return NextResponse.json({ error: 'Template de anamnese aguardando aprovação da Meta. Use a opção "WhatsApp Web" enquanto isso.' }, { status: 400 })
    }

    const phone = patient.phone.replace(/\D/g, '')
    const normalizedPhone = phone.startsWith('55') ? phone : `55${phone}`
    const firstName = patient.fullName.split(' ')[0]

    const templateParams = { '1': firstName, '2': tenant!.name, '3': parsed.data.url }
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
      patientId,
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

    return NextResponse.json({ success: true, data: message }, { status: 201 })
  } catch (error) {
    const msg = error instanceof Error ? error.message : ''
    if (msg.includes('Meta API error')) {
      const detail = msg.replace('Meta API error: ', '')
      return NextResponse.json({ error: `Falha ao enviar via WhatsApp: ${detail}` }, { status: 502 })
    }
    if (msg.includes('NEXT_REDIRECT') || msg.includes('redirect')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('Anamnesis link send API error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
