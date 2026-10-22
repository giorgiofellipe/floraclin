import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { requireWrite } from '@/lib/write-access'
import { createAuditLog } from '@/lib/audit'
import {
  getTenant,
  updateTenant,
  updateTenantSettings,
  createProcedureType,
  listProcedureTypes,
} from '@/db/queries/tenants'
import { findAvailableSlug, generateSlug } from '@/db/queries/admin-tenants'
import { hasPlaceholderName, PLACEHOLDER_NAME_SETTING } from '@/lib/clinic-placeholder'
import { scheduleLifecycleWelcome } from '@/lib/lifecycle-sender'
import { CLINIC_PHONE_REQUIRED_MESSAGE, hasClinicPhone } from '@/lib/clinic-phone'
import { createConsentTemplate } from '@/db/queries/consent'
import { DEFAULT_CONSENT_TEMPLATES } from '@/validations/consent'
import { createProduct, listProducts } from '@/db/queries/products'
import { createTemplate } from '@/db/queries/evaluation-templates'
// defaultTemplates is dynamically imported below to avoid loading 42KB on startup
import type { ProcedureCategory } from '@/types/evaluation'
import { db } from '@/db/client'
import { tenants } from '@/db/schema'
import { eq, sql } from 'drizzle-orm'
// withTransaction removed — helper functions use global db which deadlocks in transactions
import { onboardingCompleteSchema } from '@/validations/onboarding'
import { handleApiError } from '@/lib/api-error'
import { ForbiddenError, isUniqueViolation } from '@/lib/errors'

const SLUG_TAKEN_MESSAGE = 'Este link já está em uso. Escolha outro.'

export async function GET(request: Request) {
  try {
    const auth = await requireRole('owner')
    const tenant = await getTenant(auth.tenantId)
    if (!tenant) {
      return NextResponse.json({ completed: false })
    }
    const settings = (tenant.settings as Record<string, unknown>) || {}
    return NextResponse.json({ completed: settings.onboarding_completed === true })
  } catch (error) {
    // The old fallthrough answered 200 `{ completed: false }` for *any*
    // failure, so a transient DB error read as "this clinic never onboarded"
    // and would have walked an established clinic back through the wizard.
    return handleApiError(error, request)
  }
}

export async function POST(request: Request) {
  try {
    const { ctx: auth, blocked } = await requireWrite('owner')
    if (blocked) return blocked
    const body = await request.json()
    const parsed = onboardingCompleteSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Dados de onboarding inválidos', issues: parsed.error.flatten() },
        { status: 400 },
      )
    }
    const data = parsed.data
    // The wizard requires the phone before its first step; this is the same
    // rule for a request that skips the wizard. A clinic created on arrival
    // after Google sign-up gets its first phone here, and its trial welcome
    // goes to it.
    if (!hasClinicPhone(data.clinic.phone)) {
      return NextResponse.json({ error: CLINIC_PHONE_REQUIRED_MESSAGE }, { status: 400 })
    }

    // Check existing procedure types before entering transaction
    const existingTypes = await listProcedureTypes(auth.tenantId)
    // A clinic created on arrival after Google sign-up has a stand-in name and
    // no phone; this save is the first time we hear either.
    const current = await getTenant(auth.tenantId)
    const namedOnArrival = hasPlaceholderName(current?.settings)

    // NOTE: Not using withTransaction here because the helper functions
    // (updateTenant, createProcedureType, etc.) all use the global `db` client.
    // Wrapping them in a transaction would deadlock since the transaction holds
    // a connection and the helpers try to use a separate connection from the pool.
    // Onboarding is idempotent, so sequential execution is safe.

    {
      // 1. Update tenant with clinic info, working hours, and slug
      const slug = data.clinic.slug
        || await findAvailableSlug(db, generateSlug(data.clinic.name), auth.tenantId)

      try {
        await db
          .update(tenants)
          .set({ slug, updatedAt: new Date() })
          .where(eq(tenants.id, auth.tenantId))
      } catch (err) {
        if (isUniqueViolation(err, 'tenants_slug_unique')) {
          return NextResponse.json({ error: SLUG_TAKEN_MESSAGE }, { status: 409 })
        }
        throw err
      }

      await updateTenant(auth.tenantId, {
        name: data.clinic.name,
        phone: data.clinic.phone || '',
        email: data.clinic.email || '',
        address: Object.values(data.clinic.address || {}).some(v => v) ? data.clinic.address : undefined,
        workingHours: data.clinic.workingHours,
      })

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

      // 4. Seed only the products the user selected via the onboarding step.
      const existingProducts = await listProducts(auth.tenantId)
      if (existingProducts.length === 0 && data.selectedProducts.length > 0) {
        for (const p of data.selectedProducts) {
          await createProduct(auth.tenantId, {
            name: p.name,
            category: p.category,
            activeIngredient: p.activeIngredient || undefined,
            defaultUnit: p.defaultUnit || 'U',
          })
        }
      }

      // 5. Create default consent templates (idempotent — skip if any exist)
      const { listConsentTemplates } = await import('@/db/queries/consent')
      const existingTemplates = await listConsentTemplates(auth.tenantId)
      const hasTemplates = Object.values(existingTemplates).some((arr) => Array.isArray(arr) && arr.length > 0)
      if (!hasTemplates) {
        const consentTypes = [
          'general',
          'botox',
          'filler',
          'biostimulator',
          'limpeza_pele',
          'enzima',
          'skinbooster',
          'microagulhamento',
          'service_contract',
        ] as const
        for (const type of consentTypes) {
          const template = DEFAULT_CONSENT_TEMPLATES[type]
          await createConsentTemplate(auth.tenantId, {
            type,
            title: template.title,
            content: template.content,
          })
        }
      }

      // 6. Seed default clinical document templates (atestado de comparecimento)
      const { listClinicalDocumentTemplates, createClinicalDocumentTemplate } = await import('@/db/queries/clinical-documents')
      const existingDocTemplates = await listClinicalDocumentTemplates(auth.tenantId, {})
      if (existingDocTemplates.length === 0) {
        await createClinicalDocumentTemplate({
          tenantId: auth.tenantId,
          createdBy: auth.userId,
          kind: 'atestado',
          name: 'Atestado de Comparecimento',
          body: 'Atesto, para os devidos fins, que {{patient.name}} compareceu a esta clínica na data de {{date}}, para realização de consulta/procedimento estético.\n\n{{date.long}}',
        })
      }

      // 7. Mark onboarding as completed
      await updateTenantSettings(auth.tenantId, {
        onboarding_completed: true,
        ...(namedOnArrival ? { [PLACEHOLDER_NAME_SETTING]: false } : {}),
      })

      // A clinic created on arrival skipped the clinic form, so its owner saw
      // the lifecycle notice for the first time on this wizard's phone field.
      // Stamping it now is what lets lifecycle messages (and the daily run)
      // reach the clinic, and the held trial welcome goes out once, to the
      // phone just saved. Its per-channel claims make a repeated save a no-op.
      if (namedOnArrival) {
        await db
          .update(tenants)
          .set({ lifecycleNoticeAt: sql`coalesce(${tenants.lifecycleNoticeAt}, now())` })
          .where(eq(tenants.id, auth.tenantId))
        scheduleLifecycleWelcome({ tenantId: auth.tenantId })
      }

      // 8. Audit log
      await createAuditLog({
        tenantId: auth.tenantId,
        userId: auth.userId,
        action: 'update',
        entityType: 'tenant',
        entityId: auth.tenantId,
        changes: {
          onboarding: {
            old: null,
            new: {
              completed: true,
              procedureTypesCount: data.procedureTypes.length,
              productsCount: data.selectedProducts.length,
            },
          },
        },
      })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ success: false, error: 'Sem permissao para completar o onboarding' }, { status: 403 })
    }
    return handleApiError(error, request, { body: { success: false, error: 'Erro ao completar o onboarding. Tente novamente.' } })
  }
}
