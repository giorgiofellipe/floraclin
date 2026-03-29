'use server'

import { requireRole, getAuthContext } from '@/lib/auth'
import { revalidatePath } from 'next/cache'
import { withTransaction } from '@/lib/tenant'
import { createAuditLog } from '@/lib/audit'
import { productApplicationSchema } from '@/validations/procedure'
import { saveProductApplications, getProductApplications } from '@/db/queries/product-applications'
import { verifyTenantOwnership } from '@/db/queries/helpers'
import { procedureRecords } from '@/db/schema'
import type { ProductApplicationItem } from '@/validations/procedure'

// ─── Types ──────────────────────────────────────────────────────────

export type ProductApplicationActionResult = {
  success: boolean
  error?: string
  fieldErrors?: Record<string, string[]>
  data?: unknown
}

// ─── Save Product Applications (within Transaction) ─────────────────

export async function saveProductApplicationsAction(
  procedureRecordId: string,
  applications: ProductApplicationItem[]
): Promise<ProductApplicationActionResult> {
  const ctx = await requireRole('owner', 'practitioner')

  const parsed = productApplicationSchema.safeParse({
    procedureRecordId,
    applications,
  })

  if (!parsed.success) {
    return { success: false, fieldErrors: parsed.error.flatten().fieldErrors }
  }

  try {
    // Verify procedure belongs to current tenant
    await verifyTenantOwnership(ctx.tenantId, procedureRecords, procedureRecordId, 'Procedure record')

    const result = await withTransaction(async (tx) => {
      return saveProductApplications(
        ctx.tenantId,
        procedureRecordId,
        applications,
        tx
      )
    })

    await createAuditLog({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'update',
      entityType: 'product_application',
      entityId: procedureRecordId,
      changes: {
        applicationCount: { old: null, new: applications.length },
      },
    })

    revalidatePath('/pacientes')
    return { success: true, data: result }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Erro ao salvar produtos',
    }
  }
}

// ─── Get Product Applications ───────────────────────────────────────

export async function getProductApplicationsAction(procedureRecordId: string) {
  const ctx = await getAuthContext()
  const applications = await getProductApplications(ctx.tenantId, procedureRecordId)
  return { success: true, data: applications }
}
