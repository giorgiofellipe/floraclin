import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireWrite } from '@/lib/write-access'
import { getTenant } from '@/db/queries/tenants'
import { getPatient } from '@/db/queries/patients'
import { getTemplateForTenant } from '@/lib/whatsapp'
import { sendAndRecordTemplate } from '@/lib/whatsapp-automated-send'
import { firstName } from '@/lib/utils'
import { buildTemplateParams, flattenTemplateParam, TEMPLATE_TEXT_PARAM_MAX } from '@/lib/whatsapp-blueprints'
import { isWhatsAppEnabled } from '@/lib/whatsapp-mode'
import { SubscriptionExpiredError, SUBSCRIPTION_EXPIRED_RESPONSE } from '@/lib/plans'
import { normalizeBrPhoneForWhatsApp } from '@/lib/phone'
import { handleApiError } from '@/lib/api-error'

const bodySchema = z.object({
  documents: z.string().trim().min(1, 'Informe os documentos').max(TEMPLATE_TEXT_PARAM_MAX),
})

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { ctx, blocked } = await requireWrite('owner', 'practitioner', 'receptionist')
    if (blocked) return blocked

    const parsed = bodySchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Dados inválidos', fieldErrors: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    const tenant = await getTenant(ctx.tenantId)
    if (!tenant || !isWhatsAppEnabled(tenant.settings as Record<string, unknown> | null)) {
      return NextResponse.json({ error: 'WhatsApp não habilitado' }, { status: 403 })
    }

    const { id: patientId } = await params
    const patient = await getPatient(ctx.tenantId, patientId)
    if (!patient) {
      return NextResponse.json({ error: 'Paciente não encontrado' }, { status: 404 })
    }

    const template = await getTemplateForTenant(ctx.tenantId, 'document_request')
    if (template?.status !== 'APPROVED') {
      return NextResponse.json({ error: 'Mensagem de solicitação de documentos indisponível no momento.' }, { status: 400 })
    }

    await sendAndRecordTemplate({
      tenantId: ctx.tenantId,
      phone: normalizeBrPhoneForWhatsApp(patient.phone),
      recipient: { patientId: patient.id, name: patient.fullName },
      template,
      params: buildTemplateParams(template, {
        patient_name: firstName(patient.fullName),
        clinic_name: tenant.name,
        instructions: flattenTemplateParam(parsed.data.documents),
      }),
      actor: { type: 'user', userId: ctx.userId },
    })

    return NextResponse.json({ success: true }, { status: 201 })
  } catch (error) {
    if (error instanceof SubscriptionExpiredError) {
      return NextResponse.json(SUBSCRIPTION_EXPIRED_RESPONSE.body, { status: SUBSCRIPTION_EXPIRED_RESPONSE.status })
    }
    return handleApiError(error, request)
  }
}
