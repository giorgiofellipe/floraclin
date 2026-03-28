'use server'

import { requireRole } from '@/lib/auth'
import { createAuditLog } from '@/lib/audit'
import {
  getTenant,
  updateTenant,
  updateTenantSettings,
  createProcedureType,
  listProcedureTypes,
} from '@/db/queries/tenants'
import { createConsentTemplate } from '@/db/queries/consent'
import { DEFAULT_CONSENT_TEMPLATES } from '@/validations/consent'
import { db } from '@/db/client'
import { tenants } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { withTransaction } from '@/lib/tenant'
import type { WorkingHours } from '@/validations/tenant'

export type OnboardingActionState = {
  success?: boolean
  error?: string
} | null

interface OnboardingData {
  // Step 1: Clinic info
  clinic: {
    name: string
    phone?: string
    email?: string
    address?: Record<string, string>
    workingHours: WorkingHours
  }
  // Step 2: Procedure types
  procedureTypes: Array<{
    name: string
    category: string
    estimatedDurationMin?: number
    defaultPrice?: string
  }>
}

function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // remove diacritics
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 80)
}

export async function checkOnboardingCompleted(): Promise<boolean> {
  try {
    const auth = await requireRole('owner')
    const tenant = await getTenant(auth.tenantId)
    if (!tenant) return false
    const settings = (tenant.settings as Record<string, unknown>) || {}
    return settings.onboarding_completed === true
  } catch {
    return false
  }
}

export async function completeOnboarding(data: OnboardingData): Promise<OnboardingActionState> {
  try {
    const auth = await requireRole('owner')

    // Check existing procedure types before entering transaction
    const existingTypes = await listProcedureTypes(auth.tenantId)

    await withTransaction(async (tx) => {
      // 1. Update tenant with clinic info, working hours, and slug
      const slug = generateSlug(data.clinic.name)

      await updateTenant(auth.tenantId, {
        name: data.clinic.name,
        phone: data.clinic.phone || '',
        email: data.clinic.email || '',
        address: Object.values(data.clinic.address || {}).some(v => v) ? data.clinic.address : undefined,
        workingHours: data.clinic.workingHours,
      })

      // Update slug directly (not in the updateTenant validation schema)
      await tx
        .update(tenants)
        .set({ slug, updatedAt: new Date() })
        .where(eq(tenants.id, auth.tenantId))

      // 2. Create selected procedure types (only if none exist yet)
      if (existingTypes.length === 0 && data.procedureTypes.length > 0) {
        for (const pt of data.procedureTypes) {
          await createProcedureType(auth.tenantId, {
            name: pt.name,
            category: pt.category as 'botox' | 'filler' | 'biostimulator' | 'peel' | 'skinbooster' | 'laser' | 'microagulhamento' | 'outros',
            estimatedDurationMin: pt.estimatedDurationMin ?? 60,
            defaultPrice: pt.defaultPrice || '',
            isActive: true,
          })
        }
      }

      // 3. Create default consent templates (4 types)
      const consentTypes = ['general', 'botox', 'filler', 'biostimulator'] as const
      for (const type of consentTypes) {
        const template = DEFAULT_CONSENT_TEMPLATES[type]
        await createConsentTemplate(auth.tenantId, {
          type,
          title: template.title,
          content: template.content,
        })
      }

      // 4. Mark onboarding as completed
      await updateTenantSettings(auth.tenantId, {
        onboarding_completed: true,
      })

      // 5. Audit log
      await createAuditLog({
        tenantId: auth.tenantId,
        userId: auth.userId,
        action: 'update',
        entityType: 'tenant',
        entityId: auth.tenantId,
        changes: {
          onboarding: { old: null, new: { completed: true, procedureTypesCount: data.procedureTypes.length } },
        },
      })
    })

    return { success: true }
  } catch (error) {
    if (error instanceof Error && error.message === 'Forbidden: insufficient permissions') {
      return { error: 'Sem permissao para completar o onboarding' }
    }
    console.error('Onboarding error:', error)
    return { error: 'Erro ao completar o onboarding. Tente novamente.' }
  }
}
