import { NextResponse } from 'next/server'
import { subDays } from 'date-fns'
import { requireWrite } from '@/lib/write-access'
import { getTenant } from '@/db/queries/tenants'
import { claimReactivation, getPatient, releaseReactivation } from '@/db/queries/patients'
import { isMarketingOptedOut } from '@/db/queries/marketing-consent'
import { getTemplateForTenant } from '@/lib/whatsapp'
import { sendAndRecordTemplate } from '@/lib/whatsapp-automated-send'
import { firstName } from '@/lib/utils'
import { buildTemplateParams } from '@/lib/whatsapp-blueprints'
import { REACTIVATION_COOLDOWN_DAYS } from '@/lib/whatsapp-automation-config'
import { MARKETING_OPTED_OUT_ERROR } from '@/lib/whatsapp-marketing'
import { isWhatsAppEnabled } from '@/lib/whatsapp-mode'
import { SubscriptionExpiredError, SUBSCRIPTION_EXPIRED_RESPONSE } from '@/lib/plans'
import { normalizeBrPhoneForWhatsApp } from '@/lib/phone'
import { handleApiError } from '@/lib/api-error'
import { reportSideEffectFailure } from '@/lib/observability'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    // Same roles as the Pacientes inativos report, the only place that offers this send.
    const { ctx, blocked } = await requireWrite('owner', 'financial')
    if (blocked) return blocked

    const tenant = await getTenant(ctx.tenantId)
    if (!tenant || !isWhatsAppEnabled(tenant.settings as Record<string, unknown> | null)) {
      return NextResponse.json({ error: 'WhatsApp não habilitado' }, { status: 403 })
    }

    const { id: patientId } = await params
    const patient = await getPatient(ctx.tenantId, patientId)
    if (!patient) {
      return NextResponse.json({ error: 'Paciente não encontrado' }, { status: 404 })
    }
    if (await isMarketingOptedOut(ctx.tenantId, { patientId: patient.id, phone: patient.phone })) {
      return NextResponse.json({ error: MARKETING_OPTED_OUT_ERROR }, { status: 409 })
    }

    const template = await getTemplateForTenant(ctx.tenantId, 'reactivation')
    if (template?.status !== 'APPROVED') {
      return NextResponse.json({ error: 'Mensagem de reativação indisponível no momento.' }, { status: 400 })
    }

    const phone = normalizeBrPhoneForWhatsApp(patient.phone)
    const blockedSince = subDays(new Date(), REACTIVATION_COOLDOWN_DAYS)
    const claim = await claimReactivation(ctx.tenantId, patient.id, blockedSince)
    if (!claim) {
      return NextResponse.json(
        { error: `Paciente já recebeu uma mensagem de reativação nos últimos ${REACTIVATION_COOLDOWN_DAYS} dias.` },
        { status: 409 },
      )
    }

    try {
      await sendAndRecordTemplate({
        tenantId: ctx.tenantId,
        phone,
        recipient: { patientId: patient.id, name: patient.fullName },
        template,
        params: buildTemplateParams(template, { patient_name: firstName(patient.fullName), clinic_name: tenant.name }),
        actor: { type: 'user', userId: ctx.userId },
      })
    } catch (err) {
      await releaseReactivation(ctx.tenantId, patient.id, claim.previous).catch((releaseErr) =>
        reportSideEffectFailure(releaseErr, { area: 'whatsapp', step: 'reactivation_release_claim', extra: { patientId } }),
      )
      throw err
    }

    return NextResponse.json({ success: true }, { status: 201 })
  } catch (error) {
    if (error instanceof SubscriptionExpiredError) {
      return NextResponse.json(SUBSCRIPTION_EXPIRED_RESPONSE.body, { status: SUBSCRIPTION_EXPIRED_RESPONSE.status })
    }
    return handleApiError(error, request)
  }
}
