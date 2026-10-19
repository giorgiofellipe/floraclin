import { and, eq } from 'drizzle-orm'
import { db } from '@/db/client'
import { tenantUsers } from '@/db/schema'
import { getAnamnesis } from '@/db/queries/anamnesis'
import { createAnamnesisToken, deleteAnamnesisToken, hasAnamnesisTokenCreatedOnBrDay } from '@/db/queries/anamnesis-tokens'
import { getPatient } from '@/db/queries/patients'
import { getTenant } from '@/db/queries/tenants'
import { listAutomations, type WhatsappAutomation } from '@/db/queries/whatsapp'
import { getTemplateForTenant } from '@/lib/whatsapp'
import { sendAndRecordTemplate } from '@/lib/whatsapp-automated-send'
import { buildTemplateParams } from '@/lib/whatsapp-blueprints'
import { firstName } from '@/lib/utils'
import { brToday } from '@/lib/dates'
import { reportSideEffectFailure } from '@/lib/observability'
import { parseAutomationConfig } from '@/lib/whatsapp-automation-config'

export type AutoSendAnamnesisResult =
  | { status: 'sent'; metaMessageId: string }
  | { status: 'skipped'; reason: AutoSendAnamnesisSkipReason }

export type AutoSendAnamnesisSkipReason =
  | 'automation_disabled'
  | 'fresh_anamnesis'
  | 'template_missing'
  | 'template_not_approved'
  | 'patient_missing'
  | 'tenant_missing'
  | 'owner_missing'
  | 'already_sent'

interface MaybeAutoSendAnamnesisOptions {
  tenantId: string
  patientId: string
  phone: string
  automation?: Pick<WhatsappAutomation, 'trigger' | 'enabled' | 'config'> | null
  linkExpiresAt?: Date
}

export async function maybeAutoSendAnamnesisLink({
  tenantId,
  patientId,
  phone,
  automation,
  linkExpiresAt,
}: MaybeAutoSendAnamnesisOptions): Promise<AutoSendAnamnesisResult> {
  const confirmationAuto = automation === undefined
    ? (await listAutomations(tenantId)).find(
        (a) => a.trigger === 'appointment_confirmation' && a.enabled,
      )
    : automation

  if (!confirmationAuto?.enabled) {
    return { status: 'skipped', reason: 'automation_disabled' }
  }

  const config = parseAutomationConfig('appointment_confirmation', confirmationAuto.config)
  if (!config.autoAnamnesisEnabled) {
    return { status: 'skipped', reason: 'automation_disabled' }
  }

  const staleDays = config.anamnesisStaleDays
  const anamnesis = await getAnamnesis(tenantId, patientId)
  if (anamnesis?.updatedAt) {
    const daysSince = (Date.now() - new Date(anamnesis.updatedAt).getTime()) / (1000 * 60 * 60 * 24)
    if (daysSince < staleDays) {
      return { status: 'skipped', reason: 'fresh_anamnesis' }
    }
  }

  const template = await getTemplateForTenant(tenantId, 'anamnese_link')
  if (!template) {
    return { status: 'skipped', reason: 'template_missing' }
  }
  if (template.status !== 'APPROVED') {
    return { status: 'skipped', reason: 'template_not_approved' }
  }

  if (await hasAnamnesisTokenCreatedOnBrDay(tenantId, patientId, brToday())) {
    return { status: 'skipped', reason: 'already_sent' }
  }

  const patient = await getPatient(tenantId, patientId)
  if (!patient) {
    return { status: 'skipped', reason: 'patient_missing' }
  }

  const tenant = await getTenant(tenantId)
  if (!tenant) {
    return { status: 'skipped', reason: 'tenant_missing' }
  }

  const [owner] = await db
    .select({ userId: tenantUsers.userId })
    .from(tenantUsers)
    .where(and(eq(tenantUsers.tenantId, tenantId), eq(tenantUsers.role, 'owner')))
    .limit(1)
  if (!owner) {
    return { status: 'skipped', reason: 'owner_missing' }
  }

  const token = await createAnamnesisToken(tenantId, patientId, owner.userId, linkExpiresAt)

  // The token marks the day as sent, so an unsent link must not leave one behind.
  const result = await sendAndRecordTemplate({
    tenantId,
    phone,
    recipient: { patientId, name: patient.fullName },
    template,
    params: buildTemplateParams(template, { patient_name: firstName(patient.fullName), clinic_name: tenant.name }),
    buttonParams: [{
      index: 0,
      subType: 'url',
      parameters: [{ type: 'text', text: token.token }],
    }],
  }).catch(async (err) => {
    await deleteAnamnesisToken(tenantId, token.id).catch((deleteErr) =>
      reportSideEffectFailure(deleteErr, { area: 'anamnesis', step: 'delete_token', extra: { tenantId } }),
    )
    throw err
  })

  return { status: 'sent', metaMessageId: result.metaMessageId }
}
