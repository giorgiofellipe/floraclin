import { and, eq } from 'drizzle-orm'
import { db } from '@/db/client'
import { tenantUsers } from '@/db/schema'
import { getAnamnesis } from '@/db/queries/anamnesis'
import { createAnamnesisToken, hasAnamnesisTokenCreatedOnBrDay } from '@/db/queries/anamnesis-tokens'
import { getPatient } from '@/db/queries/patients'
import { getTenant } from '@/db/queries/tenants'
import {
  createMessage,
  listAutomations,
  pushSseEvent,
  upsertConversation,
  type WhatsappAutomation,
} from '@/db/queries/whatsapp'
import { getTemplateForTenant, sendTemplateMessage } from '@/lib/whatsapp'
import { brToday } from '@/lib/dates'

const DEFAULT_ANAMNESIS_STALE_DAYS = 60

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

  const config = (confirmationAuto.config ?? {}) as Record<string, unknown>
  if (!config.autoAnamnesisEnabled) {
    return { status: 'skipped', reason: 'automation_disabled' }
  }

  const staleDays = (config.anamnesisStaleDays as number) ?? DEFAULT_ANAMNESIS_STALE_DAYS
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
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.floraclin.com.br'
  const link = `${appUrl}/a/${token.token}`

  const firstName = patient.fullName.split(' ')[0] || patient.fullName
  const params: Record<string, string> = {
    '1': firstName,
    '2': tenant.name,
  }
  const buttonParams = [{
    index: 0,
    subType: 'url' as const,
    parameters: [{ type: 'text' as const, text: token.token }],
  }]

  const result = await sendTemplateMessage(
    tenantId,
    phone,
    template.name,
    template.language,
    params,
    buttonParams,
  )

  const conversation = await upsertConversation(
    tenantId,
    phone,
    patient.fullName,
    undefined,
    patientId,
  )

  const message = await createMessage(tenantId, conversation.id, {
    direction: 'outbound',
    metaMessageId: result.metaMessageId,
    body: `Olá, ${firstName}! Para agilizar seu atendimento na ${tenant.name}, pedimos que preencha sua ficha de anamnese pelo link abaixo:\n\n${link}\n\nQualquer dúvida, estamos à disposição.`,
    templateName: template.name,
    deliveryStatus: 'sent',
  })

  await pushSseEvent(tenantId, 'new_message', {
    conversationId: conversation.id,
    message,
  })

  return { status: 'sent', metaMessageId: result.metaMessageId }
}
