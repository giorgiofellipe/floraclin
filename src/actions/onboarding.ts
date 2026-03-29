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
import { createProduct } from '@/db/queries/products'
import { DEFAULT_PRODUCTS } from '@/lib/constants'
import { createTemplate } from '@/db/queries/evaluation-templates'
import { defaultTemplates } from '@/lib/default-evaluation-templates'
import type { ProcedureCategory } from '@/types/evaluation'
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

      // 3. Seed default evaluation templates for created procedure types
      if (existingTypes.length === 0 && data.procedureTypes.length > 0) {
        // Map procedure type categories to template categories
        const categoryToTemplateCategory: Record<string, ProcedureCategory> = {
          botox: 'botox',
          filler: 'filler',
          biostimulator: 'biostimulator',
          skinbooster: 'skinbooster',
          microagulhamento: 'microagulhamento',
          peel: 'limpeza_pele',
          enzima: 'enzima',
          limpeza_pele: 'limpeza_pele',
          skincare: 'skincare',
          laser: 'skincare',
          outros: 'skincare',
        }

        // Fetch newly created procedure types to get their IDs
        const createdTypes = await listProcedureTypes(auth.tenantId)

        for (const pt of createdTypes) {
          const templateCategory = categoryToTemplateCategory[pt.category]
          if (!templateCategory) continue

          const defaultTemplate = defaultTemplates.find(
            (t) => t.category === templateCategory
          )
          if (!defaultTemplate) continue

          await createTemplate(
            auth.tenantId,
            pt.id,
            defaultTemplate.name,
            defaultTemplate.sections
          )
        }
      }

      // 4. Seed default products
      for (const product of DEFAULT_PRODUCTS) {
        await createProduct(auth.tenantId, {
          name: product.name,
          category: product.category,
          activeIngredient: product.activeIngredient,
          defaultUnit: product.defaultUnit,
        }, tx)
      }

      // 5. Create default consent templates (4 types + service contract)
      const consentTypes = ['general', 'botox', 'filler', 'biostimulator', 'service_contract'] as const
      for (const type of consentTypes) {
        const template = DEFAULT_CONSENT_TEMPLATES[type]
        await createConsentTemplate(auth.tenantId, {
          type,
          title: template.title,
          content: template.content,
        })
      }

      // 6. Mark onboarding as completed
      await updateTenantSettings(auth.tenantId, {
        onboarding_completed: true,
      })

      // 7. Audit log
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
      return { error: 'Sem permissão para completar o onboarding' }
    }
    console.error('Onboarding error:', error)
    return { error: 'Erro ao completar o onboarding. Tente novamente.' }
  }
}
