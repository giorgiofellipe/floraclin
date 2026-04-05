import { NextResponse } from 'next/server'
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
// defaultTemplates is dynamically imported below to avoid loading 42KB on startup
import type { ProcedureCategory } from '@/types/evaluation'
import { db } from '@/db/client'
import { tenants } from '@/db/schema'
import { eq } from 'drizzle-orm'
// withTransaction removed — helper functions use global db which deadlocks in transactions
import type { WorkingHours } from '@/validations/tenant'

function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // remove diacritics
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 80)
}

interface OnboardingData {
  clinic: {
    name: string
    phone?: string
    email?: string
    address?: Record<string, string>
    workingHours: WorkingHours
  }
  procedureTypes: Array<{
    name: string
    category: string
    estimatedDurationMin?: number
    defaultPrice?: string
  }>
}

export async function GET() {
  try {
    const auth = await requireRole('owner')
    const tenant = await getTenant(auth.tenantId)
    if (!tenant) {
      return NextResponse.json({ completed: false })
    }
    const settings = (tenant.settings as Record<string, unknown>) || {}
    return NextResponse.json({ completed: settings.onboarding_completed === true })
  } catch (error) {
    const msg = error instanceof Error ? error.message : ''
    if (msg.includes('Forbidden')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (msg.includes('NEXT_REDIRECT') || msg.includes('redirect')) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    return NextResponse.json({ completed: false })
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requireRole('owner')
    const data: OnboardingData = await request.json()

    // Check existing procedure types before entering transaction
    const existingTypes = await listProcedureTypes(auth.tenantId)

    // NOTE: Not using withTransaction here because the helper functions
    // (updateTenant, createProcedureType, etc.) all use the global `db` client.
    // Wrapping them in a transaction would deadlock since the transaction holds
    // a connection and the helpers try to use a separate connection from the pool.
    // Onboarding is idempotent, so sequential execution is safe.

    {
      // 1. Update tenant with clinic info, working hours, and slug
      const slug = generateSlug(data.clinic.name)

      await updateTenant(auth.tenantId, {
        name: data.clinic.name,
        phone: data.clinic.phone || '',
        email: data.clinic.email || '',
        address: Object.values(data.clinic.address || {}).some(v => v) ? data.clinic.address : undefined,
        workingHours: data.clinic.workingHours,
      })

      await db
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

        const createdTypes = await listProcedureTypes(auth.tenantId)

        for (const pt of createdTypes) {
          const templateCategory = categoryToTemplateCategory[pt.category]
          if (!templateCategory) continue

          const { defaultTemplates } = await import('@/lib/default-evaluation-templates')
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
        })
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
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    if (error instanceof Error && error.message === 'Forbidden: insufficient permissions') {
      return NextResponse.json({ success: false, error: 'Sem permissao para completar o onboarding' }, { status: 403 })
    }
    const msg = error instanceof Error ? error.message : ''
    if (msg.includes('NEXT_REDIRECT') || msg.includes('redirect')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('Onboarding error:', error)
    return NextResponse.json({ success: false, error: 'Erro ao completar o onboarding. Tente novamente.' }, { status: 500 })
  }
}
