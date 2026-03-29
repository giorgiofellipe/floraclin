'use server'

import { headers } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { requireRole, getAuthContext } from '@/lib/auth'
import { createAuditLog } from '@/lib/audit'
import { withTransaction } from '@/lib/tenant'
import { consentTemplateSchema, consentAcceptanceSchema } from '@/validations/consent'
import {
  listConsentTemplates,
  createConsentTemplate,
  updateConsentTemplate,
  acceptConsent,
  getConsentHistory,
  getActiveConsentForType,
  getConsentTemplateById,
  getConsentForProcedure,
} from '@/db/queries/consent'

export type ConsentActionState = {
  error?: string
  fieldErrors?: Record<string, string[]>
  success?: boolean
  data?: unknown
} | null

// ─── Template Actions ───────────────────────────────────────────────

export async function listConsentTemplatesAction() {
  const ctx = await getAuthContext()
  return listConsentTemplates(ctx.tenantId)
}

export async function getActiveConsentForTypeAction(type: string) {
  const ctx = await getAuthContext()
  return getActiveConsentForType(ctx.tenantId, type)
}

export async function getConsentTemplateByIdAction(templateId: string) {
  const ctx = await getAuthContext()
  return getConsentTemplateById(ctx.tenantId, templateId)
}

export async function createConsentTemplateAction(
  _prevState: ConsentActionState,
  formData: FormData
): Promise<ConsentActionState> {
  const ctx = await requireRole('owner')

  const parsed = consentTemplateSchema.safeParse({
    type: formData.get('type'),
    title: formData.get('title'),
    content: formData.get('content'),
  })

  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors }
  }

  try {
    const template = await createConsentTemplate(ctx.tenantId, parsed.data)

    await createAuditLog({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'create',
      entityType: 'consent_template',
      entityId: template.id,
      changes: { template: { old: null, new: parsed.data } },
    })

    revalidatePath('/configuracoes')
    return { success: true, data: template }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Erro ao criar termo' }
  }
}

export async function updateConsentTemplateAction(
  _prevState: ConsentActionState,
  formData: FormData
): Promise<ConsentActionState> {
  const ctx = await requireRole('owner')

  const templateId = formData.get('templateId') as string
  const title = formData.get('title') as string | undefined
  const content = formData.get('content') as string

  if (!templateId || !content) {
    return { error: 'Dados incompletos' }
  }

  try {
    const template = await updateConsentTemplate(ctx.tenantId, templateId, {
      title: title || undefined,
      content,
    })

    await createAuditLog({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'update',
      entityType: 'consent_template',
      entityId: template.id,
      changes: {
        version: { old: template.version - 1, new: template.version },
      },
    })

    revalidatePath('/configuracoes')
    return { success: true, data: template }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Erro ao atualizar termo' }
  }
}

// ─── Acceptance Actions ─────────────────────────────────────────────

export async function acceptConsentAction(
  data: {
    patientId: string
    consentTemplateId: string
    procedureRecordId?: string
    acceptanceMethod: 'checkbox' | 'signature' | 'both'
    signatureData?: string
  }
): Promise<ConsentActionState> {
  const ctx = await requireRole('owner', 'practitioner')

  const parsed = consentAcceptanceSchema.safeParse(data)
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors }
  }

  try {
    const headersList = await headers()
    const ipAddress = headersList.get('x-forwarded-for')?.split(',')[0]?.trim()
      ?? headersList.get('x-real-ip')
      ?? undefined
    const userAgent = headersList.get('user-agent') ?? undefined

    const acceptance = await withTransaction(async (tx) => {
      const result = await acceptConsent(ctx.tenantId, parsed.data, {
        ipAddress,
        userAgent,
      })

      await createAuditLog({
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        action: 'consent_accepted',
        entityType: 'consent_acceptance',
        entityId: result.id,
        changes: {
          patientId: { old: null, new: data.patientId },
          consentTemplateId: { old: null, new: data.consentTemplateId },
          method: { old: null, new: data.acceptanceMethod },
        },
      }, tx)

      return result
    })

    return { success: true, data: acceptance }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Erro ao registrar aceite' }
  }
}

// ─── Per-Procedure Consent Check ───────────────────────────────────

export async function checkConsentForProcedureAction(
  patientId: string,
  procedureRecordId: string,
  consentType: string
) {
  const ctx = await getAuthContext()
  const consent = await getConsentForProcedure(ctx.tenantId, patientId, procedureRecordId, consentType)
  return { success: true, data: consent }
}

// ─── History Actions ────────────────────────────────────────────────

export async function getConsentHistoryAction(patientId: string) {
  const ctx = await getAuthContext()
  return getConsentHistory(ctx.tenantId, patientId)
}
